import type { User } from "./db/repository.ts";
import type { ClientConnection } from "./homed/client.ts";
import type { EndpointOptions } from "./homed/schema.ts";
import type { DeviceState } from "./homed/types.ts";

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
}

export interface HomedEndpoint {
  id: number;
  // Optional to avoid circular references during serialization
  device?: HomedDevice;
  exposes: string[];
  options?: EndpointOptions;
}

export class DeviceRepository {
  devices: Map<string, HomedDevice[]>;
  deviceState: Map<[string, string], DeviceState>;

  constructor() {
    this.devices = new Map();
    this.deviceState = new Map();
  }

  getClientDevice = (
    clientId: string,
    deviceId: string
  ): HomedDevice | undefined =>
    this.devices.get(clientId)?.find(d => d.key === deviceId);

  getClientDevices = (clientId: string): HomedDevice[] =>
    this.devices.get(clientId) ?? [];

  removeClientDevices = (clientId: string): void => {
    this.deviceState.keys().forEach(key => {
      if (key[0] === clientId) {
        this.deviceState.delete(key);
      }
    });
  };

  setDeviceStatus = (
    client: ClientConnection<User>,
    deviceId: string,
    online: boolean
  ): void => {
    if (client.uniqueId) {
      const state =
        this.deviceState.get([client.uniqueId, deviceId]) ??
        ({} satisfies DeviceState);

      state.status = online ? "online" : "offline";
      this.deviceState.set([client.uniqueId, deviceId], state);
    }
  };

  getDeviceState = (
    clientId: string,
    deviceId: string
  ): DeviceState | undefined => this.deviceState.get([clientId, deviceId]);
}
