import { vi } from "vitest";
import type {
  ClientToken,
  UserId,
  UserRepository,
} from "../src/db/repository.ts";
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

/**
 * Creates a mock UserRepository for testing.
 * All methods are vi.fn() no-ops by default — call counts and arguments
 * can be asserted on directly without extra setup.
 */
const makeUserRepoMocks = () => ({
  saveDevices: vi.fn(
    async (_userId: UserId, _clientId: ClientId, _devices: HomedDevice[]) => {}
  ),
  loadDevices: vi.fn(
    async (_userId: UserId) =>
      [] as Awaited<ReturnType<UserRepository["loadDevices"]>>
  ),
  loadClientDevices: vi.fn(
    async (_userId: UserId, _clientId: ClientId) => [] as HomedDevice[]
  ),
  setDeviceAvailable: vi.fn(
    async (
      _userId: UserId,
      _clientId: ClientId,
      _deviceId: DeviceId,
      _available: boolean
    ) => {}
  ),
  updateClientLastSeen: vi.fn(
    async (_userId: UserId, _clientId: ClientId) => {}
  ),
  deleteClientDevices: vi.fn(
    async (_userId: UserId, _clientId: ClientId) => {}
  ),
  deleteStaleDevices: vi.fn(async (_olderThan: Date) => 0),
  getAll: vi.fn(
    async () => [] as Awaited<ReturnType<UserRepository["getAll"]>>
  ),
});

export type MockedUserRepository = ReturnType<typeof makeUserRepoMocks> &
  UserRepository;

export const createMockUserRepository = (): MockedUserRepository =>
  makeUserRepoMocks() as unknown as MockedUserRepository;
