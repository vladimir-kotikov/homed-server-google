import { beforeEach, describe, expect, it } from "vitest";
import {
  UserRepository,
  type ClientToken,
  type UserId,
} from "../../src/db/repository.ts";
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
