import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "../../src/db/repository.ts";
import type { HomedDevice } from "../../src/device.ts";
import { DeviceRepository, type DeviceId } from "../../src/device.ts";
import type { ClientId } from "../../src/homed/client.ts";
import type { DeviceState } from "../../src/homed/types.ts";

const createUserId = (id: string): UserId => id as UserId;
const createUniqueId = (id: string): ClientId => id as ClientId;
const createDeviceId = (id: string): DeviceId => id as DeviceId;

const createMockDevice = (key: string, name?: string): HomedDevice => ({
  key,
  topic: `test/${key}`,
  name: name ?? `Device ${key}`,
  available: true,
  endpoints: [],
});

describe("DeviceRepository", () => {
  let repository: DeviceRepository;
  const userId = createUserId("user1");
  const uniqueId = createUniqueId("client1");
  const deviceId = createDeviceId("device1");

  beforeEach(() => {
    repository = new DeviceRepository();
  });

  describe("syncClientDevices", () => {
    it("should track added devices", () => {
      const device = createMockDevice("device1");
      const [added, removed] = repository.syncClientDevices(userId, uniqueId, [
        device,
      ]);

      expect(added).toHaveLength(1);
      expect(added[0].key).toBe("device1");
      expect(removed).toHaveLength(0);
    });

    it("should track removed devices", () => {
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);

      const [added, removed] = repository.syncClientDevices(
        userId,
        uniqueId,
        []
      );

      expect(added).toHaveLength(0);
      expect(removed).toHaveLength(1);
      expect(removed[0].key).toBe("device1");
    });

    it("should detect changed devices", () => {
      const device1 = createMockDevice("device1");
      const device2 = createMockDevice("device2");

      repository.syncClientDevices(userId, uniqueId, [device1]);
      const [added, removed] = repository.syncClientDevices(userId, uniqueId, [
        device1,
        device2,
      ]);

      expect(added).toHaveLength(1);
      expect(added[0].key).toBe("device2");
      expect(removed).toHaveLength(0);
    });

    it("should handle multiple clients separately", () => {
      const client2 = createUniqueId("client2");
      const device = createMockDevice("device1");

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
      const device = createMockDevice("device1");

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

  describe("getDevicesWithClientId", () => {
    it("should get devices for specific client", () => {
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);

      const allDevices = repository.getDevices(userId);
      const devices = allDevices.filter(d => d.clientId === uniqueId);

      expect(devices).toHaveLength(1);
      expect(devices[0].device.key).toBe("device1");
    });

    it("should get all devices for user across all clients", () => {
      const client2 = createUniqueId("client2");
      const device1 = createMockDevice("device1");
      const device2 = createMockDevice("device2");

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device2]);

      const allDevices = repository.getDevices(userId);

      expect(allDevices).toHaveLength(2);
      expect(allDevices.map(d => d.device.key)).toContain("device1");
      expect(allDevices.map(d => d.device.key)).toContain("device2");
    });

    it("should return empty array for non-existent client", () => {
      const devices = repository.getDevices(userId);

      expect(devices).toHaveLength(0);
    });
  });

  describe("getClientDevice", () => {
    it("should get specific device", () => {
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);

      const retrieved = repository.getDevice(userId, uniqueId, deviceId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe("device1");
    });

    it("should return undefined for non-existent device", () => {
      const device = repository.getDevice(userId, uniqueId, deviceId);

      expect(device).toBeUndefined();
    });
  });

  describe("device state management", () => {
    it("should update device availability", () => {
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);

      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      const retrievedDevice = repository.getDevice(userId, uniqueId, deviceId);

      expect(retrievedDevice?.available).toBe(true);
    });

    it("should track device as unavailable", () => {
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);

      repository.setDeviceAvailable(userId, uniqueId, deviceId, false);
      const retrievedDevice = repository.getDevice(userId, uniqueId, deviceId);

      expect(retrievedDevice?.available).toBe(false);
    });

    it("should set and merge device state", () => {
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
      const client2 = createUniqueId("client2");
      const device1 = createMockDevice("device1");
      const device2 = createMockDevice("device1");

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device2]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      repository.setDeviceAvailable(userId, client2, deviceId, false);

      const retrievedDevice1 = repository.getDevice(userId, uniqueId, deviceId);
      const retrievedDevice2 = repository.getDevice(userId, client2, deviceId);

      expect(retrievedDevice1?.available).toBe(true);
      expect(retrievedDevice2?.available).toBe(false);
    });

    it("should keep availability separate per user", () => {
      const user2 = createUserId("user2");
      const device1 = createMockDevice("device1");
      const device2 = createMockDevice("device1");

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(user2, uniqueId, [device2]);
      repository.setDeviceAvailable(userId, uniqueId, deviceId, true);
      repository.setDeviceAvailable(user2, uniqueId, deviceId, false);

      const retrievedDevice1 = repository.getDevice(userId, uniqueId, deviceId);
      const retrievedDevice2 = repository.getDevice(user2, uniqueId, deviceId);

      expect(retrievedDevice1?.available).toBe(true);
      expect(retrievedDevice2?.available).toBe(false);
    });
  });

  describe("removeDevices", () => {
    it("should remove all devices for specific client", () => {
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });

      repository.removeClientDevices(userId, uniqueId);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);
      expect(state).toBeUndefined();
    });

    it("should remove all devices for user across all clients", () => {
      const client2 = createUniqueId("client2");
      const device1 = createMockDevice("device1");
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
      const device = createMockDevice("device1");

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
      repository.updateDeviceState(userId, uniqueId, deviceId, {
        status: "on",
      });

      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.status).toBe("on");
    });

    it("should find device state across clients when client not specified", () => {
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
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([uniqueId]);
      expect(clientIds).toHaveLength(1);
    });

    it("should return multiple client IDs when multiple clients have devices", () => {
      const client2 = createUniqueId("client2");
      const client3 = createUniqueId("client3");
      const device = createMockDevice("device1");

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
      const device1 = createMockDevice("device1");
      const device2 = createMockDevice("device2");

      repository.syncClientDevices(userId, uniqueId, [device1, device2]);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([uniqueId]);
      expect(clientIds).toHaveLength(1);
    });

    it("should not include clients from other users", () => {
      const user2 = createUserId("user2");
      const client2 = createUniqueId("client2");
      const device = createMockDevice("device1");

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
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(userId, uniqueId, []);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([]);
    });

    it("should maintain correct set after device removals", () => {
      const client2 = createUniqueId("client2");
      const device = createMockDevice("device1");

      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.syncClientDevices(userId, client2, [device]);
      repository.removeClientDevices(userId, uniqueId);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([client2]);
    });
  });

  describe("state change events", () => {
    it("should emit deviceStateChanged event when state actually changes", () => {
      const device = createMockDevice("device1");
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
        deviceId,
        device,
        prevState: {},
        newState: expect.objectContaining(newState),
      });
    });

    it("should not emit event when state is identical (deduplication)", () => {
      const device = createMockDevice("device1");
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
      const device = createMockDevice("device1");
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
        deviceId,
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
      const device = createMockDevice("device1");
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
      const device = createMockDevice("device1");
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
      const device = createMockDevice("device1");
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
});
