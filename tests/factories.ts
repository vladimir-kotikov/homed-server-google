import type { ClientToken, UserId } from "../src/db/repository.ts";
import type { DeviceId, HomedDevice } from "../src/device.ts";
import type { ClientId } from "../src/homed/client.ts";

export const createUserId = (id: string): UserId => id as UserId;
export const createClientId = (id: string = "client1"): ClientId =>
  id as ClientId;
export const createDeviceId = (id: string = "zigbee/device1"): DeviceId =>
  id as DeviceId;
export const createClientToken = (token: string): ClientToken =>
  token as ClientToken;

export const createMockDevice = (
  key: DeviceId = createDeviceId("zigbee/device1"),
  name?: string
): HomedDevice => ({
  key,
  topic: key,
  name: name ?? `Device ${key}`,
  endpoints: [
    {
      id: 0,
      exposes: ["switch"],
      options: {},
    },
  ],
});
