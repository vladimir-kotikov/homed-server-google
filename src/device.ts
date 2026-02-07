import type { UserId } from "./db/repository.ts";
import type { ClientId } from "./homed/client.ts";
import type { EndpointOptions } from "./homed/schema.ts";
import type { DeviceState } from "./homed/types.ts";
import { setNested } from "./utility.ts";

export type DeviceId = string & { readonly __deviceId: unique symbol };

/**
 * Homed device structure as received from TCP clients
 */
export interface HomedDevice {
  key: string; // Device identifier (e.g., "0x123456")
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
  // Optional to avoid circular references during serialization
  device?: HomedDevice;
  exposes: string[];
  options?: EndpointOptions;
}

export class DeviceRepository {
  private devices: Record<UserId, Record<ClientId, HomedDevice[]>> = {};
  private deviceState: Record<
    UserId,
    Record<ClientId, Record<DeviceId, DeviceState>>
  > = {};

  getClientDevice = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId
  ): HomedDevice | undefined =>
    this.devices[userId]?.[clientId]?.find(d => d.key === deviceId);

  getDevices = (userId: UserId, clientId?: ClientId): HomedDevice[] =>
    clientId
      ? (this.devices[userId]?.[clientId] ?? [])
      : Object.values(this.devices[userId] ?? {}).flat();

  removeDevices = (userId: UserId, clientId?: ClientId): void => {
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

    setNested([userId, clientId], this.devices, [
      ...existingDevices.filter(ed => !removedDevices.includes(ed)),
      ...addedDevices,
    ]);

    return [addedDevices, removedDevices];
  };

  setDeviceStatus = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    online: boolean
  ): void => {
    const state =
      this.deviceState[userId]?.[clientId]?.[deviceId] ??
      ({} satisfies DeviceState);

    state.status = online ? "online" : "offline";
    setNested([userId, clientId, deviceId], this.deviceState, state);
  };

  setDeviceState = (
    userId: UserId,
    clientId: ClientId,
    deviceId: DeviceId,
    newState: Partial<DeviceState>
  ): void => {
    const state =
      this.deviceState[userId]?.[clientId]?.[deviceId] ??
      ({} satisfies DeviceState);

    Object.assign(state, newState);
    setNested([userId, clientId, deviceId], this.deviceState, state);
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
