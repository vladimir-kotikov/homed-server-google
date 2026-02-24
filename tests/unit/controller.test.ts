import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomedServerController } from "../../src/controller.ts";
import { UserRepository } from "../../src/db/repository.ts";
import { DeviceRepository, type DeviceId } from "../../src/device.ts";
import { WebApp } from "../../src/web/app.ts";
import {
  createClientId,
  createClientToken,
  createDeviceId,
  createMockDevice,
  createUserId,
} from "../factories.ts";

vi.mock("@sentry/node", () => {
  const emptyScope = () => ({
    getScopeData: vi.fn(() => ({
      tags: {},
      contexts: {},
      user: {},
      extra: {},
    })),
  });
  return {
    metrics: { increment: vi.fn(), distribution: vi.fn(), gauge: vi.fn() },
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    getCurrentScope: vi.fn(emptyScope),
    getIsolationScope: vi.fn(emptyScope),
    setContext: vi.fn(),
    setUser: vi.fn(),
    withIsolationScope: vi.fn((cb: (scope: any) => void) =>
      cb({ setContext: vi.fn(), setUser: vi.fn(), setTag: vi.fn() })
    ),
    startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    setupExpressErrorHandler: vi.fn(),
  };
});

describe("HomedServerController", () => {
  let controller: HomedServerController;
  let deviceCache: DeviceRepository;
  let userDb: UserRepository;
  let httpHandler: WebApp;

  const userId = createUserId("user1");
  const clientId = createClientId("client1");
  const clientToken = createClientToken("test-client-token");
  const deviceId = createDeviceId("zigbee/device1");

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
      const device = createMockDevice("zigbee/device1" as DeviceId);
      device.endpoints = [{ id: 1, exposes: ["switch"] }];
      deviceCache.syncClientDevices(userId, clientId, [device]);

      // Create a mock client connection
      const mockClient = {
        user: { id: userId, clientToken },
        uniqueId: clientId,
      };

      // Trigger device data update
      (controller as any).deviceDataUpdated(mockClient, `fd/${deviceId}`, {
        on: true,
      });

      // Verify state was updated in cache
      const state = deviceCache.getDeviceState(userId, deviceId, clientId);
      expect(state).toEqual({ on: true });
    });

    it("should emit state change events via DeviceRepository", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      const device = createMockDevice("zigbee/device1" as DeviceId);
      device.endpoints = [{ id: 1, exposes: ["switch"] }];
      deviceCache.syncClientDevices(userId, clientId, [device]);

      const mockClient = {
        user: { id: userId, clientToken },
        uniqueId: clientId,
      };

      // Listen for state change events
      const eventSpy = vi.fn();
      deviceCache.on("deviceStateChanged", eventSpy);

      // Update device data
      (controller as any).deviceDataUpdated(mockClient, `fd/${deviceId}`, {
        on: true,
      });

      // Verify event was emitted
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          clientId,
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

      const device = createMockDevice("zigbee/device1" as DeviceId);
      device.endpoints = [{ id: 1, exposes: ["switch"] }];
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

  describe("clientConnected — socket error handling", () => {
    // Minimal socket stub: EventEmitter + the methods clientConnected touches
    // before handing off to ClientConnection.
    class MockSocket extends EventEmitter {
      remoteAddress: string | undefined = "1.2.3.4";
      write = vi.fn();
      end = vi.fn();
    }

    it("does not throw when ECONNRESET fires on a healthcheck socket", () => {
      controller = new HomedServerController(
        userDb,
        deviceCache,
        httpHandler,
        undefined,
        ["1.2.3.4"] // healthcheck IP
      );

      const socket = new MockSocket();
      (controller as any).clientConnected(socket);

      // Without the early error listener this would throw synchronously
      expect(() =>
        socket.emit(
          "error",
          Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })
        )
      ).not.toThrow();
    });

    it("does not throw when ECONNRESET fires on a max-connections-refused socket", () => {
      controller = new HomedServerController(
        userDb,
        deviceCache,
        httpHandler,
        undefined,
        [],
        0 // maxConnections = 0 so any connection is over the limit
      );

      // Make tcpServer.connections return 1 (> 0)
      const socket = new MockSocket();
      Object.defineProperty((controller as any).tcpServer, "connections", {
        get: () => 1,
        configurable: true,
      });

      (controller as any).clientConnected(socket);

      expect(() =>
        socket.emit(
          "error",
          Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })
        )
      ).not.toThrow();
    });

    it("does not throw when ECONNRESET fires before ClientConnection registers its handler", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      const socket = new MockSocket();

      (controller as any).clientConnected(socket);

      expect(() =>
        socket.emit(
          "error",
          Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })
        )
      ).not.toThrow();
    });
  });
});
