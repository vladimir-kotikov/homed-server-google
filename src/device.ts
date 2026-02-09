import { EventEmitter } from "node:events";
import type { UserId } from "./db/repository.ts";
import type { ClientId } from "./homed/client.ts";
import type { EndpointOptions } from "./homed/schema.ts";
import type { DeviceState } from "./homed/types.ts";
import { fastDeepEqual } from "./utility.ts";

export type DeviceId = string & { readonly __deviceId: unique symbol };

/**
 * Homed device structure as received from TCP clients
 */
export interface HomedDevice {
  key: DeviceId; // Device identifier <deviceType>/<deviceAddress> (e.g. zigbee/84:fd:27:ff:fe:75:bf:44)
  topic: string; // MQTT topic for the device
  name: string; // Human-readable name
  description?: string; // Optional description
  available: boolean; // Whether device is online
  endpoints: HomedEndpoint[];
  manufacturer?: string;
  model?: string;
  version?: string;
  firmware?: string;
}

export interface HomedEndpoint {
  id: number;
  exposes: string[];
  options?: EndpointOptions;
}

/**
 * Event payload for device state changes
 */
export interface DeviceStateChangeEvent {
  userId: UserId;
  clientId: ClientId;
  deviceId: DeviceId;
  device: HomedDevice;
  prevState: DeviceState;
  newState: DeviceState;
}

/**
 * Device repository that manages device state and emits events when state changes
 */
export class DeviceRepository extends EventEmitter<{
  devicesUpdated: [UserId];
  deviceStateChanged: [DeviceStateChangeEvent];
}> {
  private devices: Record<UserId, Record<ClientId, HomedDevice[]>> = {};
  private deviceState: Record<
    UserId,
    Record<ClientId, Record<DeviceId, DeviceState>>
  > = {};

  constructor() {
    super();
  }

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

  removeClientDevices = (userId: UserId, clientId?: ClientId): void => {
    if (clientId) {
      delete this.devices[userId]?.[clientId];
      delete this.deviceState[userId]?.[clientId];
    } else {
      delete this.devices[userId];
      delete this.deviceState[userId];
    }
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

    // Emit device sync event if there were changes
    if (addedDevices.length > 0 || removedDevices.length > 0) {
      this.emit("devicesUpdated", userId);
    }

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
    if (device && device.available !== available) {
      const prevState =
        this.deviceState[userId]?.[clientId]?.[deviceId] ??
        ({} satisfies DeviceState);

      device.available = available;

      // currentState remains unchanged - availability is tracked on device object, not in state
      const newState = prevState;

      this.emit("deviceStateChanged", {
        userId,
        clientId,
        deviceId,
        device,
        prevState,
        newState,
      });
    }
  };

  updateDeviceState = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    state: Partial<DeviceState>
  ): void => {
    // Get current state
    const prevState =
      this.deviceState[userId]?.[clientId]?.[deviceId] ??
      ({} satisfies DeviceState);

    // Merge with new state
    const newState = { ...prevState, ...state };

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
        deviceId,
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
}
