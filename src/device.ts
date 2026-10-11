import * as Sentry from "@sentry/node";
import { EventEmitter } from "node:events";
import { isDeepStrictEqual } from "node:util";
import type { UserId, UserRepository } from "./db/repository.ts";
import type { ClientId } from "./homed/client.ts";
import type { EndpointOptions } from "./homed/schema.ts";
import type { CommandMessage, DeviceState } from "./homed/types.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("device-repo");
const DEVICE_TOPIC_RE =
  /^(?<prefix>[^/]+)\/(?<deviceId>.+?)(?:\/(?<endpointId>\d+))?$/;

export type DeviceId = string & { readonly __deviceId: unique symbol };

/**
 * Exposes that indicate a device can be actively controlled (actuators)
 * vs passive sensors that only report data.
 * Used for device type detection.
 */
export const CONTROLLABLE_EXPOSES = new Set([
  // Switches and relays
  "switch",
  "relay",
  "outlet",
  // Lights
  "light",
  "dimmable_light",
  "color_light",
  "brightness",
  "color",
  // Covers
  "cover",
  "blinds",
  "curtain",
  "shutter",
  // Locks
  "lock",
  "door_lock",
  // Climate control
  "thermostat",
  "temperature_controller",
  // Other actuators
  "fan",
  // Actions and scenes
  "action",
  "scene",
]);

/**
 * Determines if an array of exposes contains any controllable capabilities
 * (vs just passive sensor/metadata capabilities)
 */
export const hasControlCapabilities = (exposes: string[]): boolean =>
  exposes.some(expose => CONTROLLABLE_EXPOSES.has(expose));

/**
 * Parse device ID and optional endpoint ID from topic
 * Examples:
 *   - "fd/zigbee/device" → {prefix: "fd", deviceId: "zigbee/device", endpointId: undefined}
 *   - "fd/zigbee/device/1" → {prefix: "fd", deviceId: "zigbee/device", endpointId: 1}
 *   - "status/zigbee" -> {prefix: "status", deviceId: undefined, endpointId: undefined}
 */
export const parseDeviceTopic = (
  topic: string
): { prefix: string; deviceId: DeviceId; endpointId?: number } => {
  const match = topic.match(DEVICE_TOPIC_RE);
  if (!match || !match.groups) {
    throw new Error(`Invalid topic format: ${topic}`);
  }

  return {
    prefix: match.groups.prefix,
    deviceId: match.groups.deviceId as DeviceId,
    endpointId: match.groups.endpointId
      ? parseInt(match.groups.endpointId, 10)
      : undefined,
  };
};

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
}> {
  private devices: Record<UserId, Record<ClientId, HomedDevice[]>> = {};
  // Attempts actual delivery to the TCP client; set once by
  // HomedServerController. executeCommand()'s result reflects whether this
  // returns true, not just whether the device is cached.
  private commandSender?: (event: ExecuteCommandEvent) => boolean;
  // Diagnostics only (shown on the dashboard); timestamps in epoch ms
  private deviceDiag = new Map<
    string,
    {
      statusAt?: number; // last device/ status message (or disconnect/sync)
      statusValue?: boolean;
      stateAt?: number; // last fd/ state message
    }
  >();
  private diag = (userId: UserId, clientId: ClientId, deviceId: DeviceId) => {
    const key = `${userId}::${clientId}::${deviceId}`;
    const entry = this.deviceDiag.get(key) ?? {};
    this.deviceDiag.set(key, entry);
    return entry;
  };
  private clientLastSeen = new Map<string, number>();
  private deviceState: Record<
    UserId,
    Record<ClientId, Record<DeviceId, DeviceState>>
  > = {};
  private staleClientTimeout: number;
  private syncSettleMs: number;
  // Devices whose expose/ message (capabilities) is still expected; `done`
  // settles when it arrives or after syncSettleMs.
  // Key: `${userId}::${clientId}::${deviceId}`
  private pendingExposes = new Map<
    string,
    { done: Promise<void>; resolve: () => void }
  >();
  private userRepository: UserRepository;
  private shuttingDown = false;

  constructor(
    userRepository: UserRepository,
    staleClientTimeout: number = 2 * 24 * 60 * 60,
    syncSettleMs: number = 0
  ) {
    // Default: 2 days
    super();
    this.userRepository = userRepository;
    this.staleClientTimeout = staleClientTimeout;
    this.syncSettleMs = syncSettleMs;

    if (staleClientTimeout > 0) {
      // Run cleanup every hour or 1/24th of timeout, whichever is smaller
      const cleanupIntervalMs =
        Math.min(staleClientTimeout / 24, 60 * 60) * 1000;
      setInterval(
        () => this.cleanupStaleClients(staleClientTimeout),
        cleanupIntervalMs
      ).unref();

      log.info(
        `Stale client cleanup started (timeout: ${
          staleClientTimeout / (24 * 60 * 60)
        } days, interval: ${cleanupIntervalMs / (60 * 1000)} minutes)`
      );
    }
  }

  /**
   * Signal that the application is shutting down.
   * Suppresses all further fire-and-forget DB writes so they don't race
   * against the database connection being closed.
   */
  shutdown(): void {
    this.shuttingDown = true;
  }

  /**
   * Initialize device repository by loading persisted devices from database
   * Should be called after construction before using the repository
   */
  async init(): Promise<void> {
    log.info("Loading devices from database...");
    const allUsers = await this.userRepository.getAll();

    for (const user of allUsers) {
      const persistedDevices = await this.userRepository.loadDevices(user.id);

      for (const { clientId, device, available } of persistedDevices) {
        // Initialize in-memory structures
        this.devices[user.id] = this.devices[user.id] || {};
        this.devices[user.id][clientId] = this.devices[user.id][clientId] || [];

        // Only add if not already present (shouldn't happen but just in case)
        const existingDevice = this.devices[user.id][clientId].find(
          d => d.key === device.key
        );

        if (!existingDevice) {
          // Update device with persisted availability status
          device.available = available;
          this.devices[user.id][clientId].push(device);
          if (device.endpoints.length === 0) {
            this.expectEndpoints(user.id, clientId, device.key);
          }
        }

        // Initialize device state (will be updated by clients when they connect)
        this.deviceState[user.id] = this.deviceState[user.id] || {};
        this.deviceState[user.id][clientId] =
          this.deviceState[user.id][clientId] || {};
        this.deviceState[user.id][clientId][device.key] = {
          available,
        };
      }

      if (persistedDevices.length > 0) {
        log.info(
          `Loaded ${persistedDevices.length} devices for user ${user.id}`
        );
      }
    }
  }

  /**
   * Removes devices from clients that haven't been seen in `timeout` seconds.
   * This prevents memory bloat from disconnected clients while keeping devices
   * persistent across short-term disconnections.
   */
  private cleanupStaleClients = (timeout: number) => {
    const now = Date.now();
    const staleClients: Array<[UserId, ClientId]> = [];

    this.clientLastSeen
      .entries()
      .filter(([, lastSeen]) => now - lastSeen >= timeout * 1000)
      .forEach(([key]) => {
        const [userId, clientId] = key.split("::") as [UserId, ClientId];
        staleClients.push([userId, clientId]);
        this.clientLastSeen.delete(key);
      });

    staleClients.forEach(([userId, clientId]) => {
      const deviceCount = this.devices[userId]?.[clientId]?.length ?? 0;
      if (deviceCount > 0) {
        log.info(
          `Removing ${deviceCount} devices from stale client ${clientId}`
        );
        this.removeClientDevices(userId, clientId);
        this.emit("devicesUpdated", userId);
      }
    });

    // Also cleanup stale devices from database (older than timeout)
    if (!this.shuttingDown) {
      const staleThreshold = new Date(now - timeout * 1000);
      this.userRepository.deleteStaleDevices(staleThreshold).catch(err => {
        log.error("device.cleanup.db_delete_failed", err);
      });
    }
  };

  getDevice = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId
  ): HomedDevice | undefined => {
    const device = this.devices[userId]?.[clientId]?.find(
      d => d.key === deviceId
    );

    if (device) {
      Sentry.setContext("homed.device", {
        deviceId: device.key,
        manufacturer: device.manufacturer,
        model: device.model,
      });
      Sentry.getActiveSpan()?.setAttributes({
        "homed.device.manufacturer": device.manufacturer,
        "homed.device.model": device.model,
      });
    }

    return device;
  };

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
      this.clientLastSeen.delete(`${userId}::${clientId}`);

      // Delete from database (async, don't block)
      if (!this.shuttingDown) {
        this.userRepository.deleteClientDevices(userId, clientId).catch(err => {
          log.error("device.remove.db_delete_failed", err);
        });
      }
    } else {
      // Capture client list BEFORE deleting in-memory state
      const clientIds = Object.keys(this.devices[userId] ?? {}) as ClientId[];

      delete this.devices[userId];
      delete this.deviceState[userId];
      // Clean up all client last seen for this user
      this.clientLastSeen
        .keys()
        .filter(key => key.startsWith(`${userId}::`))
        .forEach(key => this.clientLastSeen.delete(key));

      // Delete all devices for this user from database (async, don't block)
      if (!this.shuttingDown) {
        Promise.all(
          clientIds.map(cid =>
            this.userRepository.deleteClientDevices(userId, cid)
          )
        ).catch(err => {
          log.error("device.remove_user.db_delete_failed", err);
        });
      }
    }
  };

  /**
   * Sync the devices reported by one homed service of a client.
   *
   * A client reports its devices per service (status/zigbee, status/custom,
   * ...), so when `service` is given only that service's devices (key prefix
   * `<service>/`) can be removed; other services' devices are left untouched.
   */
  syncClientDevices = (
    userId: UserId,
    clientId: ClientId,
    newDevices: HomedDevice[],
    service?: string
  ): [HomedDevice[], HomedDevice[], HomedDevice[]] => {
    // Mark client as active/seen to prevent stale cleanup
    this.clientLastSeen.set(`${userId}::${clientId}`, Date.now());

    const existingDevices = this.devices[userId]?.[clientId] ?? [];
    const prefix = service ? `${service}/` : "";
    const addedDevices = newDevices.filter(
      nd => !existingDevices.some(ed => ed.key === nd.key)
    );
    const removedDevices = existingDevices.filter(
      ed =>
        ed.key.startsWith(prefix) && !newDevices.some(nd => nd.key === ed.key)
    );
    // Existing devices whose endpoints are empty — happens when the server
    // restarts and reloads stale DB rows before endpoints were ever populated.
    // We need to re-subscribe to expose/ for these so the client sends fresh
    // capability data and the endpoints get properly filled in.
    const endpointsNeeded = existingDevices.filter(
      ed =>
        !removedDevices.includes(ed) &&
        ed.endpoints.length === 0 &&
        newDevices.some(nd => nd.key === ed.key)
    );

    this.devices[userId] = this.devices[userId] || {};
    this.devices[userId][clientId] = [
      ...existingDevices.filter(ed => !removedDevices.includes(ed)),
      ...addedDevices,
    ];

    // Initialise availability only for newly added devices.
    // Existing devices have their availability managed by device/ status
    // messages; overwriting it here on every periodic status broadcast would
    // fight that signal.
    addedDevices.forEach(device => {
      if (device.available !== undefined) {
        this.setDeviceAvailable(userId, clientId, device.key, device.available);
      }
    });

    [...addedDevices, ...endpointsNeeded].forEach(device =>
      this.expectEndpoints(userId, clientId, device.key)
    );

    if (addedDevices.length > 0 || removedDevices.length > 0) {
      this.emit("devicesUpdated", userId);
    }

    // Persist devices to database (async, don't block)
    if (!this.shuttingDown) {
      this.userRepository
        .saveDevices(userId, clientId, this.devices[userId][clientId])
        .catch(err => {
          log.error("device.sync.db_save_failed", err);
        });
    }

    return [addedDevices, removedDevices, endpointsNeeded];
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
      this.pendingExposes.get(`${userId}::${clientId}::${deviceId}`)?.resolve();
      // A client reconnect re-sends unchanged capabilities; only tell Google
      // (REQUEST_SYNC) when something changed
      const changed = !isDeepStrictEqual(device.endpoints, endpoints);
      device.endpoints = endpoints;
      if (changed) {
        this.emit("devicesUpdated", userId);
      }
    }
  };

  private expectEndpoints = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId
  ) => {
    const key = `${userId}::${clientId}::${deviceId}`;
    if (this.syncSettleMs <= 0 || this.pendingExposes.has(key)) return;

    let finish!: () => void;
    const done = new Promise<void>(resolve => (finish = resolve));
    const timer = setTimeout(finish, this.syncSettleMs).unref();
    const entry = {
      done,
      resolve: () => {
        clearTimeout(timer);
        finish();
      },
    };

    this.pendingExposes.set(key, entry);
    void done.then(
      () =>
        this.pendingExposes.get(key) === entry &&
        this.pendingExposes.delete(key)
    );
  };

  /**
   * Resolves once every device of the user whose capabilities (expose/) were
   * just requested has them, or after `syncSettleMs` at most. Google removes
   * devices missing from a SYNC (and their rooms), so SYNC must not answer
   * while the device list is still being rebuilt after a reconnect/restart.
   */
  whenSettled = (userId: UserId): Promise<void> =>
    Promise.all(
      [...this.pendingExposes]
        .filter(([key]) => key.startsWith(`${userId}::`))
        .map(([, { done }]) => done)
    ).then(() => undefined);

  /**
   * Mark all devices from a client as unavailable.
   * Called when a client disconnects to signal devices are offline
   * without removing them from memory.
   */
  setDevicesOffline = (userId: UserId, clientId: ClientId): void => {
    const devices = this.devices[userId]?.[clientId] ?? [];
    devices.forEach(device =>
      this.setDeviceAvailable(userId, clientId, device.key, false)
    );

    if (devices.length > 0) {
      log.debug("client.devices_offline", {
        clientId,
        devices: devices.length,
      });
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

    Object.assign(this.diag(userId, clientId, deviceId), {
      statusAt: Date.now(),
      statusValue: available,
    });

    // Update availability as state - this flows through normal state change detection
    this.updateDeviceState(userId, clientId, deviceId, { available });

    // Persist availability to database (async, don't block)
    if (!this.shuttingDown) {
      this.userRepository
        .setDeviceAvailable(userId, clientId, deviceId, available)
        .catch(err => {
          log.error("device.set_available.db_update_failed", err);
        });
    }
  };

  updateDeviceState = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    state: Partial<DeviceState>,
    endpointId?: number
  ): void => {
    const device = this.getDevice(userId, clientId, deviceId);
    if (!device) {
      return;
    }

    if (!("available" in state)) {
      this.diag(userId, clientId, deviceId).stateAt = Date.now();
    }

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
    if (isDeepStrictEqual(prevState, newState)) {
      return;
    }

    this.deviceState[userId] ??= {};
    this.deviceState[userId][clientId] ??= {};
    this.deviceState[userId][clientId][deviceId] = newState;

    this.emit("deviceStateChanged", {
      userId,
      clientId,
      device,
      prevState,
      newState,
    });
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

  /**
   * Per-device availability diagnostics for the dashboard: when we last got a
   * device/ status vs. fd/ state message.
   */
  getDiagnostics = (userId: UserId) =>
    this.getDevices(userId).map(({ device, clientId }) => {
      const diag = this.deviceDiag.get(`${userId}::${clientId}::${device.key}`);
      return {
        clientId,
        clientSyncedAt: this.clientLastSeen.get(`${userId}::${clientId}`),
        deviceId: device.key,
        name: device.name,
        model: [device.manufacturer, device.model].filter(Boolean).join(" "),
        available:
          this.deviceState[userId]?.[clientId]?.[device.key]?.available,
        ...diag,
      };
    });

  // Used only for debugging
  getDevicesStates = (userId: UserId) =>
    Object.values(this.deviceState[userId] ?? {});

  /** Registers the function that attempts delivery of commands to clients. */
  setCommandSender = (
    sender: (event: ExecuteCommandEvent) => boolean
  ): void => {
    this.commandSender = sender;
  };

  /**
   * Execute a command on a device
   *
   * @param userId - User ID
   * @param clientId - Client ID
   * @param deviceId - Device ID
   * @param endpointId - Optional endpoint ID for multi-endpoint devices
   * @param message - Command message
   * @returns true if the device exists and the command was delivered to the client
   */
  executeCommand = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    endpointId: number | undefined,
    message: CommandMessage
  ): boolean =>
    !!this.getDevice(userId, clientId, deviceId) &&
    (this.commandSender?.({
      userId,
      clientId,
      deviceId,
      endpointId,
      message,
    }) ??
      false);
}
