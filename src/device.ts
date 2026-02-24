import { EventEmitter } from "node:events";
import type { UserId } from "./db/repository.ts";
import type { ClientId } from "./homed/client.ts";
import type { EndpointOptions } from "./homed/schema.ts";
import type { CommandMessage, DeviceState } from "./homed/types.ts";
import { createLogger } from "./logger.ts";
import { fastDeepEqual } from "./utility.ts";

const log = createLogger("device-repo");

export type DeviceId = string & { readonly __deviceId: unique symbol };

/**
 * Homed device structure as received from TCP clients
 */
export interface HomedDevice {
  key: DeviceId; // Device identifier <deviceType>/<deviceAddress> (e.g. zigbee/84:fd:27:ff:fe:75:bf:44)
  topic: string; // MQTT topic for the device
  name: string; // Human-readable name
  description?: string; // Optional description
  endpoints: HomedEndpoint[];
  manufacturer?: string;
  model?: string;
  version?: string;
  firmware?: string;
  available?: boolean; // Device availability status (from client's 'active' field)
}

export interface HomedEndpoint {
  id: number;
  exposes: string[];
  options?: EndpointOptions;
}

export type DeviceWithState = {
  clientId: ClientId;
  device: HomedDevice;
  state: DeviceState;
};

/**
 * Event payload for device state changes
 */
export interface DeviceStateChangeEvent {
  userId: UserId;
  clientId: ClientId;
  device: HomedDevice;
  prevState: DeviceState;
  newState: DeviceState;
}

/**
 * Event payload for command execution requests
 */
export interface ExecuteCommandEvent {
  userId: UserId;
  clientId: ClientId;
  deviceId: DeviceId;
  endpointId?: number;
  message: CommandMessage;
}

/**
 * Device repository that manages device state and emits events when state changes
 */
export class DeviceRepository extends EventEmitter<{
  devicesUpdated: [UserId];
  deviceStateChanged: [DeviceStateChangeEvent];
  executeCommand: [ExecuteCommandEvent];
}> {
  private devices: Record<UserId, Record<ClientId, HomedDevice[]>> = {};
  private deviceLastSeen = new Map<string, number>();
  private deviceState: Record<
    UserId,
    Record<ClientId, Record<DeviceId, DeviceState>>
  > = {};

  constructor(availabilityTimeout: number = 0) {
    super();
    if (availabilityTimeout > 0) {
      const intervalMs = Math.min(availabilityTimeout / 3, 10) * 1000;
      setInterval(
        () => this.markDevicesUnavailable(availabilityTimeout),
        intervalMs
      ).unref(); // Don't let the interval keep the process alive artificially

      log.info(
        `Device inactivity watchdog started (timeout: ${
          availabilityTimeout
        }s, interval: ${intervalMs / 1000}s)`
      );
    }
  }

  /**
   * Marks any device offline whose last device/ message arrived longer ago
   * than `timeout` seconds.
   */
  private markDevicesUnavailable = (timeout: number) => {
    const now = Date.now();
    this.deviceLastSeen
      .entries()
      .filter(([, lastSeen]) => now - lastSeen >= timeout * 1000)
      .forEach(([key]) => {
        const [userId, clientId, deviceId] = key.split("::") as [
          UserId,
          ClientId,
          DeviceId,
        ];

        this.deviceLastSeen.delete(key);
        this.updateDeviceState(userId, clientId, deviceId, {
          available: false,
        });
        log.debug("watchdog.offline", { deviceId });
      });
  };

  getDevice = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId
  ): HomedDevice | undefined =>
    this.devices[userId]?.[clientId]?.find(d => d.key === deviceId);

  /**
   * Get all devices for a user with their associated ClientId
   */
  getDevices = (
    userId: UserId
  ): Array<{ device: HomedDevice; clientId: ClientId }> => {
    const result: Array<{ device: HomedDevice; clientId: ClientId }> = [];
    const userDevices = this.devices[userId] ?? {};

    for (const [clientId, devices] of Object.entries(userDevices)) {
      for (const device of devices) {
        result.push({ device, clientId: clientId as ClientId });
      }
    }

    return result;
  };

  /**
   * Get all devices for a user with their current state
   * Returns devices from all connected clients with their state data
   * Provider-agnostic: does not filter by capabilities
   */
  getDevicesWithState = (
    userId: UserId
  ): Array<{
    clientId: ClientId;
    device: HomedDevice;
    state: DeviceState;
  }> =>
    Object.entries(this.devices[userId] ?? {}).flatMap(([clientId, devices]) =>
      devices.map(device => ({
        clientId: clientId as ClientId,
        device,
        state:
          this.getDeviceState(userId, device.key, clientId as ClientId) ?? {},
      }))
    );

  removeClientDevices = (userId: UserId, clientId?: ClientId): void => {
    if (clientId) {
      delete this.devices[userId]?.[clientId];
      delete this.deviceState[userId]?.[clientId];
    } else {
      delete this.devices[userId];
      delete this.deviceState[userId];
    }

    // Clean up watchdog state
    const prefix = clientId ? `${userId}::${clientId}::` : `${userId}::`;
    this.deviceLastSeen
      .keys()
      .filter(key => key.startsWith(prefix))
      .forEach(key => this.deviceLastSeen.delete(key));
  };

  syncClientDevices = (
    userId: UserId,
    clientId: ClientId,
    newDevices: HomedDevice[]
  ): [HomedDevice[], HomedDevice[]] => {
    const existingDevices = this.devices[userId]?.[clientId] ?? [];
    const addedDevices = newDevices.filter(
      nd => !existingDevices.some(ed => ed.key === nd.key)
    );
    const removedDevices = existingDevices.filter(
      ed => !newDevices.some(nd => nd.key === ed.key)
    );

    this.devices[userId] = this.devices[userId] || {};
    this.devices[userId][clientId] = [
      ...existingDevices.filter(ed => !removedDevices.includes(ed)),
      ...addedDevices,
    ];

    // Initialise availability only for newly added devices.
    // Existing devices have their availability managed by device/ status messages
    // and the inactivity watchdog; overwriting it here on every periodic status
    // broadcast would fight both those signals.
    addedDevices.forEach(device => {
      if (device.available !== undefined) {
        this.setDeviceAvailable(userId, clientId, device.key, device.available);
      }
    });

    // Do not emit devicesUpdated here, wait for exposes to be handled and
    // added via updateDevice to avoid multiple SYNC events and possible

    return [addedDevices, removedDevices];
  };

  /**
   * Update device capabilities (endpoints/exposes)
   * Emits event for Google Home SYNC
   */
  updateDevice = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    endpoints: HomedEndpoint[]
  ): void => {
    const device = this.getDevice(userId, clientId, deviceId);
    if (device) {
      device.endpoints = endpoints;
      // It's unclear if we should emit devicesUpdated here as the devices
      // updated one by one, which triggers a cascade of sync requests. Perhaps easier would be to debounce the homegraph call
      this.emit("devicesUpdated", userId);
    }
  };

  setDeviceAvailable = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    available: boolean
  ): void => {
    const device = this.getDevice(userId, clientId, deviceId);
    if (!device) {
      return;
    }

    // Any device/ message — online or offline — counts as a liveness signal.
    // Refreshing the watchdog timer here means the watchdog only fires if homed
    // stops sending device/ messages entirely, regardless of reported status.
    this.deviceLastSeen.set(`${userId}::${clientId}::${deviceId}`, Date.now());
    // Update availability as state - this flows through normal state change detection
    this.updateDeviceState(userId, clientId, deviceId, { available });
  };

  updateDeviceState = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    state: Partial<DeviceState>,
    endpointId?: number
  ): void => {
    // Get current state
    const prevState =
      this.deviceState[userId]?.[clientId]?.[deviceId] ??
      ({} satisfies DeviceState);

    // Merge with new state
    let newState: DeviceState;

    if (endpointId !== undefined) {
      // Store endpoint-specific state nested under endpoint number
      const prevStateWithEndpoints = prevState as DeviceState & {
        endpoints?: Record<number, Partial<DeviceState>>;
      };
      const endpoints: Record<number, Partial<DeviceState>> = {
        ...prevStateWithEndpoints.endpoints,
      };
      endpoints[endpointId] = {
        ...(endpoints[endpointId] ?? {}),
        ...state,
      };
      newState = { ...prevState, endpoints } as DeviceState;
    } else {
      // Merge at root level for non-endpoint state
      newState = { ...prevState, ...state };
    }

    // Check if state actually changed
    if (fastDeepEqual(prevState, newState)) {
      return;
    }

    this.deviceState[userId] ??= {};
    this.deviceState[userId][clientId] ??= {};
    this.deviceState[userId][clientId][deviceId] = newState;

    const device = this.getDevice(userId, clientId, deviceId);
    if (device) {
      this.emit("deviceStateChanged", {
        userId,
        clientId,
        device,
        prevState,
        newState,
      });
    }
  };

  getDeviceState = (
    userId: UserId,
    deviceId: DeviceId,
    clientId?: ClientId
  ): DeviceState | undefined => {
    if (clientId) {
      return this.deviceState[userId]?.[clientId]?.[deviceId];
    }

    return Object.values(this.deviceState[userId] ?? {}).find(
      state => state[deviceId] !== undefined
    )?.[deviceId];
  };

  getConnectedClientIds = (userId: UserId): ClientId[] => {
    const userDevices = this.devices[userId];
    if (!userDevices) {
      return [];
    }

    return Object.entries(userDevices)
      .filter(([, devices]) => devices.length > 0)
      .map(([clientId]) => clientId as ClientId);
  };

  // Used only for debugging
  getDevicesStates = (userId: UserId) =>
    Object.values(this.deviceState[userId] ?? {});

  /**
   * Execute a command on a device
   * Validates device exists and emits executeCommand event
   *
   * @param userId - User ID
   * @param clientId - Client ID
   * @param deviceId - Device ID
   * @param endpointId - Optional endpoint ID for multi-endpoint devices
   * @param message - Command message
   * @returns true if device exists and event emitted, false otherwise
   */
  executeCommand = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    endpointId: number | undefined,
    message: CommandMessage
  ): boolean =>
    !!this.getDevice(userId, clientId, deviceId) &&
    this.emit("executeCommand", {
      userId,
      clientId,
      deviceId,
      endpointId,
      message,
    });
}
