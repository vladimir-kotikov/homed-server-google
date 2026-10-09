import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomedServerController } from "../../src/controller.ts";
import { UserRepository } from "../../src/db/repository.ts";
import { DeviceRepository, type DeviceId } from "../../src/device.ts";
import { WebApp } from "../../src/web/app.ts";
import {
  createClientId,
  createClientToken,
  createDeviceId,
  createMockDevice,
  createMockUserRepository,
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
    getActiveSpan: vi.fn(() => ({ setAttributes: vi.fn() })),
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
    deviceCache = new DeviceRepository(createMockUserRepository());
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

  describe("clientStatusUpdated", () => {
    const mockClient = () => ({
      user: { id: userId, clientToken },
      uniqueId: clientId,
      subscribe: vi.fn(),
    });

    it("should sync a zigbee device from status/zigbee", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      (controller as any).clientStatusUpdated(mockClient(), "status/zigbee", {
        devices: [
          {
            ieeeAddress: "00:11:22:33:44:55:66:77",
            name: "Living room switch",
            cloud: true,
            active: true,
          },
        ],
        names: false,
      });

      const device = deviceCache.getDevice(
        userId,
        clientId,
        createDeviceId("zigbee/00:11:22:33:44:55:66:77")
      );
      expect(device?.name).toBe("Living room switch");
    });

    it("keeps devices (and their capabilities) of other services across status messages", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);
      const client = mockClient();
      const zigbeeStatus = {
        devices: [
          {
            ieeeAddress: "00:11:22:33:44:55:66:77",
            name: "Lamp",
            cloud: true,
            active: true,
          },
        ],
        names: false,
      };
      const customStatus = {
        devices: [{ id: "tv", name: "TV", cloud: true, active: true }],
        names: false,
      };
      const lampId = createDeviceId("zigbee/00:11:22:33:44:55:66:77");

      (controller as any).clientStatusUpdated(
        client,
        "status/zigbee",
        zigbeeStatus
      );
      deviceCache.updateDevice(userId, clientId, lampId, [
        { id: 0, exposes: ["light"] },
      ]);
      // A reconnect replays the retained status messages of every service
      (controller as any).clientStatusUpdated(
        client,
        "status/custom",
        customStatus
      );
      (controller as any).clientStatusUpdated(
        client,
        "status/zigbee",
        zigbeeStatus
      );

      expect(
        deviceCache.getDevice(userId, clientId, lampId)?.endpoints
      ).toHaveLength(1);
      expect(
        deviceCache.getDevice(userId, clientId, createDeviceId("custom/tv"))
      ).toBeDefined();
    });

    it("removes a device from its own service when it disappears from that service's list", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);
      const client = mockClient();
      const tv = { id: "tv", name: "TV", cloud: true, active: true };
      const lamp = {
        ieeeAddress: "00:11:22:33:44:55:66:77",
        name: "Lamp",
        cloud: true,
        active: true,
      };

      (controller as any).clientStatusUpdated(client, "status/zigbee", {
        devices: [lamp],
      });
      (controller as any).clientStatusUpdated(client, "status/custom", {
        devices: [tv],
      });
      (controller as any).clientStatusUpdated(client, "status/custom", {
        devices: [],
      });

      expect(
        deviceCache.getDevice(userId, clientId, createDeviceId("custom/tv"))
      ).toBeUndefined();
      expect(
        deviceCache.getDevice(
          userId,
          clientId,
          createDeviceId("zigbee/00:11:22:33:44:55:66:77")
        )
      ).toBeDefined();
    });

    it("should skip the zigbee coordinator entry", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      (controller as any).clientStatusUpdated(mockClient(), "status/zigbee", {
        devices: [
          {
            ieeeAddress: "00:00:00:00:00:00:00:00",
            name: "HOMEd Coordinator",
            cloud: true,
            active: true,
          },
        ],
        names: false,
      });

      const device = deviceCache.getDevice(
        userId,
        clientId,
        createDeviceId("zigbee/00:00:00:00:00:00:00:00")
      );
      expect(device).toBeUndefined();
    });

    it("should sync a custom (virtual) device from status/custom", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      (controller as any).clientStatusUpdated(mockClient(), "status/custom", {
        devices: [
          {
            id: "tv-power",
            name: "TV Power",
            cloud: true,
            active: true,
          },
        ],
        names: false,
      });

      const device = deviceCache.getDevice(
        userId,
        clientId,
        createDeviceId("custom/tv-power")
      );
      expect(device?.name).toBe("TV Power");
    });

    it("should fall back to id as name for an unnamed custom device", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      (controller as any).clientStatusUpdated(mockClient(), "status/custom", {
        devices: [{ id: "tv-power", cloud: true, active: true }],
        names: false,
      });

      const device = deviceCache.getDevice(
        userId,
        clientId,
        createDeviceId("custom/tv-power")
      );
      expect(device?.name).toBe("tv-power");
    });

    it("should skip custom devices without the cloud flag", () => {
      controller = new HomedServerController(userDb, deviceCache, httpHandler);

      (controller as any).clientStatusUpdated(mockClient(), "status/custom", {
        devices: [{ id: "tv-power", name: "TV Power", active: true }],
        names: false,
      });

      const device = deviceCache.getDevice(
        userId,
        clientId,
        createDeviceId("custom/tv-power")
      );
      expect(device).toBeUndefined();
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

describe("HomedServerController — disconnect grace", () => {
  const userId = createUserId("user1");
  const clientId = createClientId("client1");
  const GRACE_MS = 30_000;

  let deviceCache: DeviceRepository;
  let userDb: UserRepository;
  let controller: HomedServerController;
  let setDevicesOffline: ReturnType<typeof vi.spyOn>;

  const fakeClient = () =>
    ({
      user: { id: userId },
      uniqueId: clientId,
      authorize: vi.fn(),
      close: vi.fn(),
    }) as any;

  const connect = (client: ReturnType<typeof fakeClient>) => {
    (controller as any).clients[userId] ??= {};
    (controller as any).clients[userId][clientId] = client;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    deviceCache = new DeviceRepository(createMockUserRepository());
    setDevicesOffline = vi.spyOn(deviceCache, "setDevicesOffline");
    userDb = UserRepository.open(":memory:", "test-secret", { create: true });
    controller = new HomedServerController(
      userDb,
      deviceCache,
      { handleRequest: vi.fn() } as unknown as WebApp,
      undefined,
      [],
      100,
      5,
      GRACE_MS
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks devices offline only after the grace period", () => {
    const client = fakeClient();
    connect(client);

    controller.clientDisconnected(client);
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(setDevicesOffline).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(setDevicesOffline).toHaveBeenCalledExactlyOnceWith(userId, clientId);
  });

  it("never marks devices offline when the client reconnects within the grace period", async () => {
    const oldClient = fakeClient();
    connect(oldClient);
    controller.clientDisconnected(oldClient);

    vi.spyOn(userDb, "getByToken").mockResolvedValue({ id: userId } as any);
    controller.clientTokenReceived(fakeClient(), createClientToken("t"));
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);

    expect(setDevicesOffline).not.toHaveBeenCalled();
  });

  it("ignores a stale connection closing after a newer one replaced it", () => {
    const oldClient = fakeClient();
    const newClient = fakeClient();
    connect(newClient);

    controller.clientDisconnected(oldClient);
    vi.advanceTimersByTime(GRACE_MS * 2);

    expect(setDevicesOffline).not.toHaveBeenCalled();
    expect((controller as any).clients[userId][clientId]).toBe(newClient);
  });

  it("marks devices offline on the next tick when no grace period is configured", () => {
    controller = new HomedServerController(userDb, deviceCache, {
      handleRequest: vi.fn(),
    } as unknown as WebApp);
    const client = fakeClient();
    connect(client);

    controller.clientDisconnected(client);
    vi.advanceTimersByTime(0);

    expect(setDevicesOffline).toHaveBeenCalledExactlyOnceWith(userId, clientId);
  });
});
