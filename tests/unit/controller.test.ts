import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomedServerController } from "../../src/controller.ts";
import type { UserId } from "../../src/db/repository.ts";
import { UserRepository } from "../../src/db/repository.ts";
import type { DeviceId, HomedDevice } from "../../src/device.ts";
import { DeviceRepository } from "../../src/device.ts";
import type { HomeGraphClient } from "../../src/google/homeGraph.ts";
import type { ClientId } from "../../src/homed/client.ts";
import { WebApp } from "../../src/web/app.ts";

const createUserId = (id: string): UserId => id as UserId;
const createClientId = (id: string): ClientId => id as ClientId;
const createDeviceId = (id: string): DeviceId => id as DeviceId;

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
  let mockHomeGraph: HomeGraphClient;
  let httpHandler: WebApp;

  const userId = createUserId("user1");
  const clientId = createClientId("client1");
  const deviceId = createDeviceId("device1");

  beforeEach(() => {
    deviceCache = new DeviceRepository();
    userDb = UserRepository.open(":memory:", "test-secret", { create: true });

    // Mock WebApp with handleRequest
    httpHandler = {
      handleRequest: vi.fn(),
    } as unknown as WebApp;

    // Create mock HomeGraphClient
    mockHomeGraph = {
      reportStateChange: vi.fn(),
      updateDevices: vi.fn(),
    } as unknown as HomeGraphClient;
  });

  describe("deviceDataUpdated", () => {
    it("should call googleHomeGraph.reportStateChange after updating device state", () => {
      controller = new HomedServerController(
        userDb,
        deviceCache,
        httpHandler,
        mockHomeGraph
      );

      // Setup: Add device to cache
      const device = createMockDevice("device1", ["switch"]);
      deviceCache.syncClientDevices(userId, clientId, [device]);

      // Create a mock client connection
      const mockClient = {
        user: { id: userId },
        uniqueId: clientId,
      };

      // Trigger device data update
      (controller as any).deviceDataUpdated(mockClient, deviceId, { on: true });

      // Verify reportStateChange was called
      expect(mockHomeGraph.reportStateChange).toHaveBeenCalledWith(
        userId,
        deviceId,
        expect.objectContaining({
          online: true,
          on: true,
        })
      );
    });

    it("should not fail when googleHomeGraph is not initialized", () => {
      // Controller without HomeGraphClient
      controller = new HomedServerController(
        userDb,
        deviceCache,
        httpHandler,
        undefined // No HomeGraph
      );

      const device = createMockDevice("device1", ["switch"]);
      deviceCache.syncClientDevices(userId, clientId, [device]);

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

    it("should map device state to Google format before reporting", () => {
      controller = new HomedServerController(
        userDb,
        deviceCache,
        httpHandler,
        mockHomeGraph
      );

      // Setup: device with brightness
      const device = createMockDevice("device1", ["dimmable_light"]);
      deviceCache.syncClientDevices(userId, clientId, [device]);

      const mockClient = {
        user: { id: userId },
        uniqueId: clientId,
      };

      // Update with Homed format
      (controller as any).deviceDataUpdated(mockClient, deviceId, {
        brightness: 50,
        state: "ON",
      });

      // Verify state is mapped to Google format
      expect(mockHomeGraph.reportStateChange).toHaveBeenCalledWith(
        userId,
        deviceId,
        expect.objectContaining({
          brightness: expect.any(Number),
          on: expect.any(Boolean),
        })
      );
    });

    it("should only report devices with traits", () => {
      controller = new HomedServerController(
        userDb,
        deviceCache,
        httpHandler,
        mockHomeGraph
      );

      // Setup: device without exposes (no traits)
      const device = createMockDevice("device1", []);
      deviceCache.syncClientDevices(userId, clientId, [device]);

      const mockClient = {
        user: { id: userId },
        uniqueId: clientId,
      };

      // Update device data
      (controller as any).deviceDataUpdated(mockClient, deviceId, {
        someData: "value",
      });

      // Should not call reportStateChange for devices without traits
      expect(mockHomeGraph.reportStateChange).not.toHaveBeenCalled();
    });

    it("should handle missing device gracefully", () => {
      controller = new HomedServerController(
        userDb,
        deviceCache,
        httpHandler,
        mockHomeGraph
      );

      // No device in cache
      const mockClient = {
        user: { id: userId },
        uniqueId: clientId,
      };

      // Should not throw or call reportStateChange
      expect(() =>
        (controller as any).deviceDataUpdated(mockClient, deviceId, {
          on: true,
        })
      ).not.toThrow();

      expect(mockHomeGraph.reportStateChange).not.toHaveBeenCalled();
    });

    it("should not report when client is not authorized", () => {
      controller = new HomedServerController(
        userDb,
        deviceCache,
        httpHandler,
        mockHomeGraph
      );

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

      // Should not report
      expect(mockHomeGraph.reportStateChange).not.toHaveBeenCalled();
    });
  });
});
