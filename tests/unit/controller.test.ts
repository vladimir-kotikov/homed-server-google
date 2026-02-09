import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomedServerController } from "../../src/controller.ts";
import type { ClientToken, UserId } from "../../src/db/repository.ts";
import { UserRepository } from "../../src/db/repository.ts";
import type { DeviceId, HomedDevice } from "../../src/device.ts";
import { DeviceRepository } from "../../src/device.ts";
import type { ClientId } from "../../src/homed/client.ts";
import { WebApp } from "../../src/web/app.ts";

const createUserId = (id: string): UserId => id as UserId;
const createClientId = (id: string): ClientId => id as ClientId;
const createDeviceId = (id: string): DeviceId => id as DeviceId;
const createClientToken = (token: string): ClientToken => token as ClientToken;

const createMockDevice = (
  key: string,
  exposes: string[] = []
): HomedDevice => ({
  key,
  topic: `test/${key}`,
  name: `Device ${key}`,
  available: true,
  endpoints: [
    {
      id: 0,
      exposes,
      options: {},
    },
  ],
});

describe("HomedServerController", () => {
  let controller: HomedServerController;
  let deviceCache: DeviceRepository;
  let userDb: UserRepository;
  let httpHandler: WebApp;

  const userId = createUserId("user1");
  const clientId = createClientId("client1");
  const clientToken = createClientToken("test-client-token");
  const deviceId = createDeviceId("device1");

  beforeEach(() => {
    deviceCache = new DeviceRepository();
    userDb = UserRepository.open(":memory:", "test-secret", { create: true });

    // Mock WebApp with handleRequest
    httpHandler = {
      handleRequest: vi.fn(),
    } as unknown as WebApp;
  });

  describe("deviceDataUpdated", () => {
    it("should update device state in cache", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      // Setup: Add device to cache
      const device = createMockDevice("device1", ["switch"]);
      deviceCache.syncClientDevices(userId, clientId, [device]);

      // Create a mock client connection
      const mockClient = {
        user: { id: userId, clientToken },
        uniqueId: clientId,
      };

      // Trigger device data update
      (controller as any).deviceDataUpdated(mockClient, deviceId, { on: true });

      // Verify state was updated in cache
      const state = deviceCache.getDeviceState(userId, deviceId, clientId);
      expect(state).toEqual({ on: true });
    });

    it("should emit state change events via DeviceRepository", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      const device = createMockDevice("device1", ["switch"]);
      deviceCache.syncClientDevices(userId, clientId, [device]);

      const mockClient = {
        user: { id: userId, clientToken },
        uniqueId: clientId,
      };

      // Listen for state change events
      const eventSpy = vi.fn();
      deviceCache.on("deviceStateChange", eventSpy);

      // Update device data
      (controller as any).deviceDataUpdated(mockClient, deviceId, {
        on: true,
      });

      // Verify event was emitted
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          clientId,
          deviceId,
          device,
          newState: { on: true },
        })
      );
    });

    it("should handle missing device gracefully", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      // No device in cache
      const mockClient = {
        user: { id: userId },
        uniqueId: clientId,
      };

      // Should not throw
      expect(() =>
        (controller as any).deviceDataUpdated(mockClient, deviceId, {
          on: true,
        })
      ).not.toThrow();
    });

    it("should not update when client is not authorized", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      const device = createMockDevice("device1", ["switch"]);
      deviceCache.syncClientDevices(userId, clientId, [device]);

      // Client without user
      const mockClient = {
        user: undefined,
        uniqueId: clientId,
      };

      (controller as any).deviceDataUpdated(mockClient, deviceId, {
        on: true,
      });

      // State should not be updated
      const state = deviceCache.getDeviceState(userId, deviceId, clientId);
      expect(state).toBeUndefined();
    });
  });
});
