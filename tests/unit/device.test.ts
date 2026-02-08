import { beforeEach, describe, expect, it } from "vitest";
import type { UserId } from "../../src/db/repository.ts";
import type { HomedDevice } from "../../src/device.ts";
import { DeviceRepository, type DeviceId } from "../../src/device.ts";
import type { ClientId } from "../../src/homed/client.ts";

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

      const retrieved = repository.getClientDevice(userId, uniqueId, deviceId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe("device1");
    });

    it("should return undefined for non-existent device", () => {
      const device = repository.getClientDevice(userId, uniqueId, deviceId);

      expect(device).toBeUndefined();
    });
  });

  describe("device state management", () => {
    it("should set and get device status", () => {
      repository.setDeviceStatus(userId, uniqueId, deviceId, true);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.status).toBe("online");
    });

    it("should track device as offline", () => {
      repository.setDeviceStatus(userId, uniqueId, deviceId, false);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.status).toBe("offline");
    });

    it("should set and merge device state", () => {
      repository.setDeviceState(userId, uniqueId, deviceId, {
        status: "online",
      });
      repository.setDeviceState(userId, uniqueId, deviceId, {
        data: { brightness: 100 },
      });

      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.status).toBe("online");
      expect(state?.data).toEqual({ brightness: 100 });
    });

    it("should keep state separate per client", () => {
      const client2 = createUniqueId("client2");

      repository.setDeviceStatus(userId, uniqueId, deviceId, true);
      repository.setDeviceStatus(userId, client2, deviceId, false);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(userId, deviceId, client2);

      expect(state1?.status).toBe("online");
      expect(state2?.status).toBe("offline");
    });

    it("should keep state separate per user", () => {
      const user2 = createUserId("user2");

      repository.setDeviceStatus(userId, uniqueId, deviceId, true);
      repository.setDeviceStatus(user2, uniqueId, deviceId, false);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(user2, deviceId, uniqueId);

      expect(state1?.status).toBe("online");
      expect(state2?.status).toBe("offline");
    });
  });

  describe("removeDevices", () => {
    it("should remove all devices for specific client", () => {
      const device = createMockDevice("device1");
      repository.syncClientDevices(userId, uniqueId, [device]);
      repository.setDeviceStatus(userId, uniqueId, deviceId, true);

      repository.removeDevices(userId, uniqueId);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);
      expect(state).toBeUndefined();
    });

    it("should remove all devices for user across all clients", () => {
      const client2 = createUniqueId("client2");
      const device1 = createMockDevice("device1");
      const deviceId2 = createDeviceId("device2");

      repository.syncClientDevices(userId, uniqueId, [device1]);
      repository.syncClientDevices(userId, client2, [device1]);
      repository.setDeviceStatus(userId, uniqueId, deviceId, true);
      repository.setDeviceStatus(userId, client2, deviceId2, true);

      repository.removeDevices(userId);

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
      repository.setDeviceStatus(userId, uniqueId, deviceId, true);
      repository.setDeviceStatus(user2, uniqueId, deviceId, true);

      repository.removeDevices(userId, uniqueId);

      const state1 = repository.getDeviceState(userId, deviceId, uniqueId);
      const state2 = repository.getDeviceState(user2, deviceId, uniqueId);

      expect(state1).toBeUndefined();
      expect(state2).toBeDefined();
    });
  });

  describe("getDeviceState", () => {
    it("should get device state with specific client", () => {
      repository.setDeviceStatus(userId, uniqueId, deviceId, true);

      const state = repository.getDeviceState(userId, deviceId, uniqueId);

      expect(state?.status).toBe("online");
    });

    it("should find device state across clients when client not specified", () => {
      repository.setDeviceStatus(userId, uniqueId, deviceId, true);

      const state = repository.getDeviceState(userId, deviceId);

      expect(state?.status).toBe("online");
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
      repository.removeDevices(userId, uniqueId);

      const clientIds = repository.getConnectedClientIds(userId);

      expect(clientIds).toEqual([client2]);
    });
  });
});
