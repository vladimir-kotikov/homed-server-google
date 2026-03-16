import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceRepository, type DeviceId } from "../../src/device.ts";
import type { DeviceState } from "../../src/homed/types.ts";
import {
  createClientId,
  createDeviceId,
  createMockDevice,
  createUserId,
} from "../factories.ts";

vi.mock("../../src/logger.ts", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("DeviceRepository", () => {
  let repository: DeviceRepository;
  const userId = createUserId("user1");
  const uniqueId = createClientId("client1");
  const deviceId = createDeviceId();

  beforeEach(() => {
    repository = new DeviceRepository();
  });

  describe("syncClientDevices", () => {
    it("should track added devices", () => {
      const device = createMockDevice();
      const [added, removed] = repository.syncClientDevices(userId, uniqueId, [
        device,
      ]);

      expect(added).toHaveLength(1);
      expect(added[0].key).toBe("zigbee/device1");
      expect(removed).toHaveLength(0);
    });

    it("should track removed devices", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const [added, removed] = repository.syncClientDevices(
        userId,
        uniqueId,
        []
      );

      expect(added).toHaveLength(0);
      expect(removed).toHaveLength(1);
      expect(removed[0].key).toBe("zigbee/device1");
    });

    it("should detect changed devices", () => {
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1]);
      const [added, removed] = repository.syncClientDevices(userId, uniqueId, [
        device1,
        device2,
      ]);

      expect(added).toHaveLength(1);
      expect(added[0].key).toBe("zigbee/device2");
      expect(removed).toHaveLength(0);
    });

    it("should handle multiple clients separately", () => {
      const client2 = createClientId("client2");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(userId, client2, []);

      const allDevices = repository.getDevices(userId);
      const devices1 = allDevices.filter(d => d.clientId === uniqueId);
      const devices2 = allDevices.filter(d => d.clientId === client2);

      expect(devices1).toHaveLength(1);
      expect(devices2).toHaveLength(0);
    });

    it("should handle multiple users separately", () => {
      const user2 = createUserId("user2");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(user2, uniqueId, []);

      const devices1 = repository
        .getDevices(userId)
        .filter(d => d.clientId === uniqueId);
      const devices2 = repository
        .getDevices(user2)
        .filter(d => d.clientId === uniqueId);

      expect(devices1).toHaveLength(1);
      expect(devices2).toHaveLength(0);
    });
  });

  describe("devicesUpdated event", () => {
    it("should emit devicesUpdated when devices are added", () => {
      const device = createMockDevice();
      const eventSpy = vi.fn();
      repository.on("devicesUpdated", eventSpy);

      repository.syncClientDevices(userId, uniqueId, [device]);

      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledWith(userId);
    });

    it("should emit devicesUpdated when devices are removed", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const eventSpy = vi.fn();
      repository.on("devicesUpdated", eventSpy);

      // Remove all devices by syncing empty array
      repository.syncClientDevices(userId, uniqueId, []);

      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledWith(userId);
    });

    it("should not emit devicesUpdated when device list unchanged", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const eventSpy = vi.fn();
      repository.on("devicesUpdated", eventSpy);

      // Sync same devices again
      repository.syncClientDevices(userId, uniqueId, [device]);

      expect(eventSpy).not.toHaveBeenCalled();
    });

    it("should emit devicesUpdated when both adding and removing devices", () => {
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);
      const device3 = createMockDevice("zigbee/device3" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1, device2]);

      const eventSpy = vi.fn();
      repository.on("devicesUpdated", eventSpy);

      // Replace device1 and device2 with device2 and device3
      // (removes device1, adds device3, keeps device2)
      repository.syncClientDevices(userId, uniqueId, [device2, device3]);

      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledWith(userId);
    });
  });

  describe("getDevicesWithClientId", () => {
    it("should get devices for specific client", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const allDevices = repository.getDevices(userId);
      const devices = allDevices.filter(d => d.clientId === uniqueId);

      expect(devices).toHaveLength(1);
      expect(devices[0].device.key).toBe("zigbee/device1");
    });

    it("should get all devices for user across all clients", () => {
      const client2 = createClientId("client2");
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device2]);

      const allDevices = repository.getDevices(userId);

      expect(allDevices).toHaveLength(2);
      expect(allDevices.map(d => d.device.key)).toContain("zigbee/device1");
      expect(allDevices.map(d => d.device.key)).toContain("zigbee/device2");
    });

    it("should return empty array for non-existent client", () => {
      const devices = repository.getDevices(userId);

      expect(devices).toHaveLength(0);
    });
  });

  describe("getClientDevice", () => {
    it("should get specific device", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const retrieved = repository.getDevice(userId, uniqueId, deviceId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe("zigbee/device1");
    });

    it("should return undefined for non-existent device", () => {
      const device = repository.getDevice(userId, uniqueId, deviceId);

      expect(device).toBeUndefined();
    });
  });

  describe("device state management", () => {
    it("should update device availability", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.available).toBe(true);
    });

    it("should track device as unavailable", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      repository.setDeviceAvailable(userId, uniqueId, deviceId, false);
      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.available).toBe(false);
    });

    it("should set and merge device state", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "online",
      });
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        data: { brightness: 100 },
      });

      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.status).toBe("online");
      expect(state?.data).toEqual({ brightness: 100 });
    });

    it("should keep availability separate per client", () => {
      const client2 = createClientId("client2");
      const device1 = createMockDevice();
      const device2 = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device2]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      repository.setDeviceAvailable(userId, client2, deviceId, false);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(userId, deviceId, client2);

      expect(state1?.available).toBe(true);
      expect(state2?.available).toBe(false);
    });

    it("should keep availability separate per user", () => {
      const user2 = createUserId("user2");
      const device1 = createMockDevice();
      const device2 = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(user2, uniqueId, [device2]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      repository.setDeviceAvailable(user2, uniqueId, deviceId, false);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(user2, deviceId, uniqueId);

      expect(state1?.available).toBe(true);
      expect(state2?.available).toBe(false);
    });
  });

  describe("removeDevices", () => {
    it("should remove all devices for specific client", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });

      repository.removeClientDevices(userId, uniqueId);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);
      expect(state).toBeUndefined();
    });

    it("should remove all devices for user across all clients", () => {
      const client2 = createClientId("client2");
      const device1 = createMockDevice();
      const deviceId2 = createDeviceId("device2");

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device1]);
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });
      repository.updateDeviceState(userId, client2, deviceId2, {
        status: "on",
      });

      repository.removeClientDevices(userId);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(userId, deviceId2, client2);

      expect(state1).toBeUndefined();
      expect(state2).toBeUndefined();
    });

    it("should only remove devices for specific user", () => {
      const user2 = createUserId("user2");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(user2, uniqueId, [device]);
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });
      repository.updateDeviceState(user2, uniqueId, deviceId, { status: "on" });

      repository.removeClientDevices(userId, uniqueId);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(user2, deviceId, uniqueId);

      expect(state1).toBeUndefined();
      expect(state2).toBeDefined();
    });
  });

  describe("getDeviceState", () => {
    it("should get device state with specific client", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });

      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.status).toBe("on");
    });

    it("should find device state across clients when client not specified", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });

      const state = repository.getDeviceState(userId, deviceId);

      expect(state?.status).toBe("on");
    });

    it("should return undefined for non-existent device state", () => {
      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state).toBeUndefined();
    });
  });

  describe("getConnectedClientIds", () => {
    it("should return empty array when user has no clients", () => {
      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([]);
    });

    it("should return single client ID when one client has devices", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([uniqueId]);
      expect(clientIds).toHaveLength(1);
    });

    it("should return multiple client IDs when multiple clients have devices", () => {
      const client2 = createClientId("client2");
      const client3 = createClientId("client3");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(userId, client2, [device]);
      repository.syncClientDevices(userId, client3, [device]);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual(
        expect.arrayContaining([uniqueId, client2, client3])
      );
      expect(clientIds).toHaveLength(3);
    });

    it("should return each client ID only once", () => {
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1, device2]);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([uniqueId]);
      expect(clientIds).toHaveLength(1);
    });

    it("should not include clients from other users", () => {
      const user2 = createUserId("user2");
      const client2 = createClientId("client2");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(user2, client2, [device]);

      const user1ClientIds = repository.getConnectedClientIds(userId);
      const user2ClientIds = repository.getConnectedClientIds(user2);

      expect(user1ClientIds).toEqual([uniqueId]);
      expect(user2ClientIds).toEqual([client2]);
      expect(user1ClientIds).not.toContain(client2);
      expect(user2ClientIds).not.toContain(uniqueId);
    });

    it("should remove client when all devices are removed", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(userId, uniqueId, []);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([]);
    });

    it("should maintain correct set after device removals", () => {
      const client2 = createClientId("client2");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(userId, client2, [device]);
      repository.removeClientDevices(userId, uniqueId);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([client2]);
    });
  });

  describe("getDevicesWithState", () => {
    it("should return devices with their current states", () => {
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1, device2]);
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
        data: { brightness: 75 },
      });
      repository.updateDeviceState(
        userId,
        uniqueId,
        "zigbee/device2" as DeviceId,
        { status: "off" }
      );

      const devicesWithState = repository.getDevicesWithState(userId);

      expect(devicesWithState).toHaveLength(2);
      expect(devicesWithState[0]).toMatchObject({
        device: device1,
        clientId: uniqueId,
        state: { status: "on", data: { brightness: 75 } },
      });
      expect(devicesWithState[1]).toMatchObject({
        device: device2,
        clientId: uniqueId,
        state: { status: "off" },
      });
    });

    it("should return empty state for devices without state updates", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const devicesWithState = repository.getDevicesWithState(userId);

      expect(devicesWithState).toHaveLength(1);
      expect(devicesWithState[0]).toMatchObject({
        device,
        clientId: uniqueId,
        state: {},
      });
    });

    it("should include devices from multiple clients", () => {
      const client2 = createClientId("client2");
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device2]);
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });
      repository.updateDeviceState(
        userId,
        client2,
        "zigbee/device2" as DeviceId,
        { status: "off" }
      );

      const devicesWithState = repository.getDevicesWithState(userId);

      expect(devicesWithState).toHaveLength(2);
      expect(devicesWithState.map(d => d.clientId)).toContain(uniqueId);
      expect(devicesWithState.map(d => d.clientId)).toContain(client2);
    });

    it("should return empty array for user with no devices", () => {
      const devicesWithState = repository.getDevicesWithState(userId);

      expect(devicesWithState).toEqual([]);
    });

    it("should not filter out devices without endpoints (provider-agnostic)", () => {
      const device = createMockDevice();
      device.endpoints = []; // Device with no endpoints

      repository.syncClientDevices(userId, uniqueId, [device]);

      const devicesWithState = repository.getDevicesWithState(userId);

      expect(devicesWithState).toHaveLength(1);
      expect(devicesWithState[0].device.endpoints).toEqual([]);
    });
  });

  describe("state change events", () => {
    it("should emit deviceStateChanged event when state actually changes", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      const newState: Partial<DeviceState> = {
        status: "on",
        data: { brightness: 50 },
      };
      repository.updateDeviceState(userId, uniqueId, deviceId, newState);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        userId,
        clientId: uniqueId,
        device,
        prevState: {},
        newState: expect.objectContaining(newState),
      });
    });

    it("should not emit event when state is identical (deduplication)", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      const state: Partial<DeviceState> = {
        status: "on",
        data: { brightness: 50 },
      };
      repository.updateDeviceState(userId, uniqueId, deviceId, state);
      repository.updateDeviceState(userId, uniqueId, deviceId, state);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should emit event when partial state update changes values", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const listener = vi.fn();

      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
        data: { brightness: 50 },
      });
      repository.on("deviceStateChanged", listener);

      repository.updateDeviceState(userId, uniqueId, deviceId, {
        data: { brightness: 75 },
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        userId,
        clientId: uniqueId,
        device,
        prevState: {
          status: "on",
          data: { brightness: 50 },
        },
        newState: expect.objectContaining({
          status: "on",
          data: { brightness: 75 },
        }),
      });
    });

    it("should emit event on first state update (no previous state)", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      const newState: Partial<DeviceState> = { status: "on" };
      repository.updateDeviceState(userId, uniqueId, deviceId, newState);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should not emit event when device does not exist", () => {
      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it("should handle deep equality check for nested objects", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const listener = vi.fn();
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
        data: { brightness: 50, color: { r: 255, g: 0, b: 0 } },
      });

      repository.on("deviceStateChanged", listener);

      // Same values, different object reference
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
        data: { brightness: 50, color: { r: 255, g: 0, b: 0 } },
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it("should emit event when nested object values change", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const listener = vi.fn();
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
        data: { brightness: 50, color: { r: 255, g: 0, b: 0 } },
      });

      repository.on("deviceStateChanged", listener);

      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
        data: { brightness: 50, color: { r: 0, g: 255, b: 0 } },
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // Watchdog timeout used across all availability watchdog tests.
  // interval = min(30/3, 10) * 1000 = 10_000 ms
  const WATCHDOG_TIMEOUT_S = 30;
  const WATCHDOG_INTERVAL_MS = 10_000;

  describe("availability watchdog", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      repository = new DeviceRepository(WATCHDOG_TIMEOUT_S);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("marks a device offline after it stops sending device/ messages", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      // Advance past the timeout — watchdog fires at next interval tick
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000 + WATCHDOG_INTERVAL_MS);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);
      expect(state?.available).toBe(false);
    });

    it("emits a single deviceStateChanged event when marking offline", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000 + WATCHDOG_INTERVAL_MS);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          newState: expect.objectContaining({ available: false }),
        })
      );
    });

    it("does not mark a device offline if device/ messages arrive within the timeout", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      // Refresh before the timeout expires
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000 - 1);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      // Advance well past the original timestamp — but lastSeen was just refreshed
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);
      expect(state?.available).toBe(true);
    });

    it("refreshes the watchdog timer on device/offline messages too", () => {
      // Even a device/offline message is a liveness signal — homed is still
      // reporting, so the watchdog should not fire on top of it.
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000 - 1);
      // homed sends an explicit offline
      repository.setDeviceAvailable(userId, uniqueId, deviceId, false);

      // Advance further — the watchdog should not override the explicit offline
      // with another offline (no extra event), and the timer was refreshed
      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000);

      // No additional event: device is already offline and watchdog backed off
      expect(listener).not.toHaveBeenCalled();
    });

    it("recovers a device when device/online arrives after watchdog offline", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      // Let the watchdog fire
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000 + WATCHDOG_INTERVAL_MS);
      expect(
        repository.getDeviceState(userId, deviceId, uniqueId)?.available
      ).toBe(false);

      // homed sends device/online
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      expect(
        repository.getDeviceState(userId, deviceId, uniqueId)?.available
      ).toBe(true);
    });

    it("does not mark a device offline more than once per stale entry", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      // Advance far enough for multiple watchdog ticks
      vi.advanceTimersByTime(
        WATCHDOG_TIMEOUT_S * 1000 + WATCHDOG_INTERVAL_MS * 3
      );

      // Should have fired exactly once (watchdog deletes the key after first hit)
      const offlineCalls = listener.mock.calls.filter(
        ([e]) => e.newState?.available === false
      );
      expect(offlineCalls).toHaveLength(1);
    });

    it("does not affect devices belonging to other users", () => {
      const user2 = createUserId("user2");
      const device1 = createMockDevice();
      const device2 = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(user2, uniqueId, [device2]);

      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      // user2's device never gets a device/ message — no lastSeen entry

      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000 + WATCHDOG_INTERVAL_MS);

      // user1's device should be marked offline (its lastSeen expired)
      expect(
        repository.getDeviceState(userId, deviceId, uniqueId)?.available
      ).toBe(false);
      // user2's device has no lastSeen entry so watchdog never touches it
      expect(
        repository.getDeviceState(user2, deviceId, uniqueId)?.available
      ).toBeUndefined();
    });

    it("cleans up watchdog state when client devices are removed", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);

      repository.removeClientDevices(userId, uniqueId);

      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      // Watchdog should not fire for removed devices
      vi.advanceTimersByTime(WATCHDOG_TIMEOUT_S * 1000 + WATCHDOG_INTERVAL_MS);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("syncClientDevices availability seeding", () => {
    it("seeds availability for newly added devices", () => {
      const device = createMockDevice();
      device.available = false;

      repository.syncClientDevices(userId, uniqueId, [device]);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);
      expect(state?.available).toBe(false);
    });

    it("does not overwrite availability for existing devices on re-sync", () => {
      const device = createMockDevice();
      device.available = true;
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, false);

      // Re-sync with available:true — should NOT restore to true
      repository.syncClientDevices(userId, uniqueId, [
        { ...device, available: true },
      ]);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);
      expect(state?.available).toBe(false);
    });

    it("does not seed availability when field is absent", () => {
      const device = createMockDevice(); // no available field
      repository.syncClientDevices(userId, uniqueId, [device]);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);
      expect(state?.available).toBeUndefined();
    });
  });

  describe("markClientDevicesOffline", () => {
    it("marks all devices from a client as unavailable", () => {
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);
      repository.syncClientDevices(userId, uniqueId, [device1, device2]);

      // Set both devices online first
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      repository.setDeviceAvailable(
        userId,
        uniqueId,
        "zigbee/device2" as DeviceId,
        true
      );

      // Mark all client devices offline
      repository.setDevicesOffline(userId, uniqueId);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(
        userId,
        "zigbee/device2" as DeviceId,
        uniqueId
      );

      expect(state1?.available).toBe(false);
      expect(state2?.available).toBe(false);
    });

    it("emits state change events for all marked devices", () => {
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);
      repository.syncClientDevices(userId, uniqueId, [device1, device2]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      repository.setDeviceAvailable(
        userId,
        uniqueId,
        "zigbee/device2" as DeviceId,
        true
      );

      const listener = vi.fn();
      repository.on("deviceStateChanged", listener);

      repository.setDevicesOffline(userId, uniqueId);

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          newState: expect.objectContaining({ available: false }),
        })
      );
    });

    it("does not affect devices from other clients", () => {
      const client2 = createClientId("client2");
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device2]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      repository.setDeviceAvailable(
        userId,
        client2,
        "zigbee/device2" as DeviceId,
        true
      );

      repository.setDevicesOffline(userId, uniqueId);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(
        userId,
        "zigbee/device2" as DeviceId,
        client2
      );

      expect(state1?.available).toBe(false);
      expect(state2?.available).toBe(true); // Other client unaffected
    });

    it("handles clients with no devices gracefully", () => {
      expect(() =>
        repository.setDevicesOffline(userId, uniqueId)
      ).not.toThrow();
    });
  });

  describe("stale client cleanup", () => {
    const STALE_TIMEOUT_S = 60; // 1 minute for testing
    const CLEANUP_INTERVAL_MS = (STALE_TIMEOUT_S / 24) * 1000; // 2.5 seconds

    beforeEach(() => {
      vi.useFakeTimers();
      repository = new DeviceRepository(0, STALE_TIMEOUT_S);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("removes devices from clients that haven't synced in timeout period", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      // Advance past the stale timeout
      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 + CLEANUP_INTERVAL_MS);

      const devices = repository.getDevices(userId);
      expect(devices).toHaveLength(0);
    });

    it("emits devicesUpdated event when cleaning up stale clients", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      const listener = vi.fn();
      repository.on("devicesUpdated", listener);

      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 + CLEANUP_INTERVAL_MS);

      expect(listener).toHaveBeenCalledWith(userId);
    });

    it("does not remove devices from recently active clients", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      // Advance time but refresh before timeout
      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 - 1000);
      repository.syncClientDevices(userId, uniqueId, [device]);

      // Advance past original timeout but not past refreshed timestamp
      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000);

      const devices = repository.getDevices(userId);
      expect(devices).toHaveLength(1);
    });

    it("keeps active clients while removing stale ones", () => {
      const client2 = createClientId("client2");
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device2]);

      // Advance time and refresh only client2
      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 - 1000);
      repository.syncClientDevices(userId, client2, [device2]);

      // Advance to expire uniqueId but not client2
      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000);

      const devices = repository.getDevices(userId);
      expect(devices).toHaveLength(1);
      expect(devices[0].clientId).toBe(client2);
    });

    it("handles multiple stale clients for same user", () => {
      const client2 = createClientId("client2");
      const device1 = createMockDevice();
      const device2 = createMockDevice("zigbee/device2" as DeviceId);

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device2]);

      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 + CLEANUP_INTERVAL_MS);

      const devices = repository.getDevices(userId);
      expect(devices).toHaveLength(0);
    });

    it("cleans up stale clients separately per user", () => {
      const user2 = createUserId("user2");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(user2, uniqueId, [device]);

      // Advance and refresh only user2
      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 - 1000);
      repository.syncClientDevices(user2, uniqueId, [device]);

      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000);

      const devices1 = repository.getDevices(userId);
      const devices2 = repository.getDevices(user2);

      expect(devices1).toHaveLength(0); // Stale
      expect(devices2).toHaveLength(1); // Recently active
    });

    it("does not run cleanup when staleClientTimeout is 0", () => {
      vi.useRealTimers();
      const repoWithoutCleanup = new DeviceRepository(0, 0);
      const device = createMockDevice();

      repoWithoutCleanup.syncClientDevices(userId, uniqueId, [device]);

      // Device should remain even without any timer logic
      const devices = repoWithoutCleanup.getDevices(userId);
      expect(devices).toHaveLength(1);
    });

    it("cleans up client lastSeen tracking when devices removed", () => {
      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      repository.removeClientDevices(userId, uniqueId);

      const listener = vi.fn();
      repository.on("devicesUpdated", listener);

      // Should not emit event for already-removed client
      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 + CLEANUP_INTERVAL_MS);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("client last-seen tracking", () => {
    it("updates client last-seen on syncClientDevices", () => {
      const STALE_TIMEOUT_S = 60;
      vi.useFakeTimers();
      repository = new DeviceRepository(0, STALE_TIMEOUT_S);

      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);

      // Advance time then sync again
      vi.advanceTimersByTime(30000); // 30 seconds
      repository.syncClientDevices(userId, uniqueId, [device]);

      // Advance to original expiry - should still exist due to refresh
      vi.advanceTimersByTime(40000); // Total 70s, but refreshed at 30s

      const devices = repository.getDevices(userId);
      expect(devices).toHaveLength(1);

      vi.useRealTimers();
    });

    it("tracks multiple clients independently", () => {
      const STALE_TIMEOUT_S = 60;
      vi.useFakeTimers();
      repository = new DeviceRepository(0, STALE_TIMEOUT_S);

      const client2 = createClientId("client2");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      vi.advanceTimersByTime(20000);
      repository.syncClientDevices(userId, client2, [device]);

      // Advance to expire first client
      vi.advanceTimersByTime(50000); // Total 70s, first expired, second at 50s

      const devices = repository.getDevices(userId);
      expect(devices).toHaveLength(1);
      expect(devices[0].clientId).toBe(client2);

      vi.useRealTimers();
    });

    it("cleans up lastSeen on removeClientDevices with clientId", () => {
      const STALE_TIMEOUT_S = 60;
      const CLEANUP_INTERVAL_MS = (STALE_TIMEOUT_S / 24) * 1000;
      vi.useFakeTimers();
      repository = new DeviceRepository(0, STALE_TIMEOUT_S);

      const device = createMockDevice();
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.removeClientDevices(userId, uniqueId);

      const listener = vi.fn();
      repository.on("devicesUpdated", listener);

      // Should not trigger cleanup for removed client
      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 + CLEANUP_INTERVAL_MS);
      expect(listener).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("cleans up all lastSeen entries on removeClientDevices without clientId", () => {
      const STALE_TIMEOUT_S = 60;
      const CLEANUP_INTERVAL_MS = (STALE_TIMEOUT_S / 24) * 1000;
      vi.useFakeTimers();
      repository = new DeviceRepository(0, STALE_TIMEOUT_S);

      const client2 = createClientId("client2");
      const device = createMockDevice();

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(userId, client2, [device]);
      repository.removeClientDevices(userId); // Remove all for user

      const listener = vi.fn();
      repository.on("devicesUpdated", listener);

      vi.advanceTimersByTime(STALE_TIMEOUT_S * 1000 + CLEANUP_INTERVAL_MS);
      expect(listener).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
