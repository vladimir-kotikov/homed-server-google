import { beforeEach, describe, expect, it } from "vitest";
import {
  UserRepository,
  type ClientToken,
  type UserId,
} from "../../src/db/repository.ts";
import {
  createMockDevice,
  createClientId,
  createDeviceId,
} from "../factories.ts";
import { initializeTestDatabase } from "../integration/testDatabase.ts";

describe("UatasaseerRepository", () => {
  let repository: UserRepository;

  beforeEach(() => {
    const database = initializeTestDatabase();
    repository = new UserRepository(database, "test-secret");
  });

  describe("getOrCreate", () => {
    it("should create a new user with branded types", async () => {
      const userId = "user123" as UserId;
      const user = await repository.getOrCreate(userId, "testuser");

      expect(user.id).toBe(userId);
      expect(user.username).toBe("testuser");
      expect(user.clientToken).toBeDefined();
    });

    it("should return existing user if already exists", async () => {
      const userId = "user123" as UserId;
      const user1 = await repository.getOrCreate(userId, "testuser");
      const user2 = await repository.getOrCreate(userId, "testuser");

      expect(user1.id).toBe(user2.id);
      expect(user1.clientToken).toBe(user2.clientToken);
    });
  });

  describe("getById", () => {
    it("should find user by id", async () => {
      const userId = "user123" as UserId;
      await repository.getOrCreate(userId, "testuser");

      const user = await repository.getById(userId);

      expect(user).toBeDefined();
      expect(user?.id).toBe(userId);
      expect(user?.username).toBe("testuser");
    });

    it("should return undefined for non-existent user", async () => {
      const userId = "non-existent" as UserId;
      const user = await repository.getById(userId);

      expect(user).toBeUndefined();
    });

    it("should return undefined after user deletion", async () => {
      const userId = "user123" as UserId;
      await repository.getOrCreate(userId, "testuser");
      await repository.delete(userId);

      const user = await repository.getById(userId);

      expect(user).toBeUndefined();
    });
  });

  describe("getByToken", () => {
    it("should find user by token", async () => {
      const userId = "user123" as UserId;
      const user1 = await repository.getOrCreate(userId, "testuser");
      const user2 = await repository.getByToken(user1.clientToken);

      expect(user2).toBeDefined();
      expect(user2?.id).toBe(userId);
    });

    it("should return undefined for invalid token", async () => {
      const invalidToken = "invalid-token" as ClientToken;
      const user = await repository.getByToken(invalidToken);

      expect(user).toBeUndefined();
    });

    it("should handle token type safety", async () => {
      const userId = "user123" as UserId;
      const user1 = await repository.getOrCreate(userId, "testuser");

      // TypeScript should ensure we pass ClientToken type
      const token: ClientToken = user1.clientToken;
      const user2 = await repository.getByToken(token);

      expect(user2?.id).toBe(userId);
    });
  });

  describe("delete", () => {
    it("should delete user", async () => {
      const userId = "user123" as UserId;
      await repository.getOrCreate(userId, "testuser");

      await repository.delete(userId);

      const user = await repository.getByToken("any-token" as ClientToken);
      expect(user?.id).not.toBe(userId);
    });
  });

  describe("token generation", () => {
    it("should generate unique tokens for different users", async () => {
      const user1 = await repository.getOrCreate("user1" as UserId, "user1");
      const user2 = await repository.getOrCreate("user2" as UserId, "user2");

      expect(user1.clientToken).not.toBe(user2.clientToken);
    });

    it("should return the same token for existing user", async () => {
      const userId = "user123" as UserId;
      const user1 = await repository.getOrCreate(userId, "testuser");
      const token1: ClientToken = user1.clientToken;

      // Get existing user, token should be same
      const user2 = await repository.getOrCreate(userId, "testuser");
      const token2: ClientToken = user2.clientToken;

      expect(token1).toBe(token2);
    });
  });
});

describe("UserRepository — device persistence", () => {
  let repository: UserRepository;
  const userId = "user-1" as UserId;
  const clientId = createClientId("client-1");

  beforeEach(() => {
    const database = initializeTestDatabase();
    repository = new UserRepository(database, "test-secret");
  });

  describe("saveDevices / loadDevices", () => {
    it("returns empty array when no devices have been saved", async () => {
      const result = await repository.loadDevices(userId);
      expect(result).toEqual([]);
    });

    it("saves and loads devices back for the correct user", async () => {
      const device = createMockDevice();
      await repository.saveDevices(userId, clientId, [device]);

      const result = await repository.loadDevices(userId);
      expect(result).toHaveLength(1);
      expect(result[0].clientId).toBe(clientId);
      expect(result[0].device.key).toBe(device.key);
      expect(result[0].available).toBe(true);
    });

    it("saves multiple devices in a single call", async () => {
      const devices = [
        createMockDevice(undefined, "Device A"),
        createMockDevice(
          "zigbee/device2" as ReturnType<typeof createMockDevice>["key"],
          "Device B"
        ),
      ];
      await repository.saveDevices(userId, clientId, devices);

      const result = await repository.loadDevices(userId);
      expect(result).toHaveLength(2);
    });

    it("upserts — second save with same key overwrites device data", async () => {
      const device = createMockDevice();
      await repository.saveDevices(userId, clientId, [device]);

      const updated = { ...device, name: "Updated Name" };
      await repository.saveDevices(userId, clientId, [updated]);

      const result = await repository.loadDevices(userId);
      expect(result).toHaveLength(1);
      expect(result[0].device.name).toBe("Updated Name");
    });

    it("does not return devices for a different user", async () => {
      const otherUser = "other-user" as UserId;
      const device = createMockDevice();
      await repository.saveDevices(userId, clientId, [device]);

      const result = await repository.loadDevices(otherUser);
      expect(result).toEqual([]);
    });

    it("is a no-op for an empty device list", async () => {
      await expect(
        repository.saveDevices(userId, clientId, [])
      ).resolves.toBeUndefined();
      expect(await repository.loadDevices(userId)).toEqual([]);
    });
  });

  describe("setDeviceAvailable", () => {
    it("updates the available flag for a specific device", async () => {
      const device = createMockDevice();
      await repository.saveDevices(userId, clientId, [device]);

      await repository.setDeviceAvailable(userId, clientId, device.key, false);

      const result = await repository.loadDevices(userId);
      expect(result[0].available).toBe(false);
    });

    it("is a no-op for a non-existent device", async () => {
      await expect(
        repository.setDeviceAvailable(
          userId,
          clientId,
          createDeviceId("no-such-device"),
          true
        )
      ).resolves.toBeUndefined();
    });
  });

  describe("deleteClientDevices", () => {
    it("removes all devices for a specific client", async () => {
      const device = createMockDevice();
      await repository.saveDevices(userId, clientId, [device]);
      await repository.deleteClientDevices(userId, clientId);

      expect(await repository.loadDevices(userId)).toEqual([]);
    });

    it("only removes devices for the specified client", async () => {
      const otherClient = createClientId("client-2");
      const device = createMockDevice();
      await repository.saveDevices(userId, clientId, [device]);
      await repository.saveDevices(userId, otherClient, [device]);

      await repository.deleteClientDevices(userId, clientId);

      const result = await repository.loadDevices(userId);
      expect(result).toHaveLength(1);
      expect(result[0].clientId).toBe(otherClient);
    });
  });

  describe("deleteStaleDevices", () => {
    it("deletes devices last seen before the threshold", async () => {
      const device = createMockDevice();
      await repository.saveDevices(userId, clientId, [device]);

      // Threshold in the future — everything older than now is stale
      const result = await repository.deleteStaleDevices(
        new Date(Date.now() + 1000)
      );
      expect(result).toBe(1);
      expect(await repository.loadDevices(userId)).toEqual([]);
    });

    it("does not delete devices that are still fresh", async () => {
      const device = createMockDevice();
      await repository.saveDevices(userId, clientId, [device]);

      // Threshold in the past — nothing is stale
      const result = await repository.deleteStaleDevices(
        new Date(Date.now() - 10_000)
      );
      expect(result).toBe(0);
      expect(await repository.loadDevices(userId)).toHaveLength(1);
    });
  });

  describe("getAll", () => {
    it("returns all users", async () => {
      await repository.getOrCreate(userId, "user1");
      await repository.getOrCreate("user-2" as UserId, "user2");

      const all = await repository.getAll();
      expect(all.map(u => u.id)).toEqual(
        expect.arrayContaining([userId, "user-2"])
      );
    });

    it("returns empty array when no users exist", async () => {
      expect(await repository.getAll()).toEqual([]);
    });
  });
});
