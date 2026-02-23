/**
 * Unit tests for OAuth functionality
 * Tests UserRepository token routines with opaque AES-256-GCM access/refresh tokens
 * and JWT authorization codes.
 */
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it } from "vitest";
import { UserRepository, type UserId } from "../../src/db/repository.ts";

describe("UserRepository - Token Routines", () => {
  let repository: UserRepository;
  const JWT_SECRET = "test-secret-key-that-is-long-enough-for-tests";
  const TEST_USER_ID = "test-user-id" as UserId;

  beforeEach(() => {
    const sqliteDatabase = new (Database as unknown as typeof Database)(
      ":memory:"
    );

    // Create schema matching the actual production schema
    sqliteDatabase.exec(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" TEXT PRIMARY KEY,
        "username" TEXT NOT NULL,
        "client_token" TEXT NOT NULL UNIQUE,
        "created_at" INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "sessions" (
        "sid" TEXT PRIMARY KEY,
        "sess" TEXT NOT NULL,
        "expire" TEXT NOT NULL
      );
    `);

    // Insert a test user
    sqliteDatabase
      .prepare(
        `INSERT INTO "user" (id, username, client_token, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        TEST_USER_ID,
        "testuser@example.com",
        "test-client-token",
        Date.now()
      );

    repository = new UserRepository(sqliteDatabase, JWT_SECRET);
  });

  describe("Authorization Code (issueCode)", () => {
    it("should generate an opaque authorization code", () => {
      const code = repository.issueCode(TEST_USER_ID);

      expect(code).toBeDefined();
      expect(typeof code).toBe("string");
      // Must be opaque — not a three-part JWT
      expect(code.split(".").length).not.toBe(3);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should generate different codes for different calls", () => {
      const code1 = repository.issueCode(TEST_USER_ID);
      const code2 = repository.issueCode(TEST_USER_ID);

      // Random IV guarantees uniqueness
      expect(code1).not.toBe(code2);
    });
  });

  describe("Opaque Access Token (issueToken / verifyAccessToken)", () => {
    it("should generate an opaque (non-JWT) access token", () => {
      const token = repository.issueToken("access", 3600, TEST_USER_ID);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      // Opaque tokens must NOT look like JWTs (three dot-separated base64url parts)
      expect(token.split(".").length).not.toBe(3);
      // Should be a valid base64url string
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should generate an opaque (non-JWT) refresh token", () => {
      const token = repository.issueToken("refresh", 604_800, TEST_USER_ID);

      expect(token).toBeDefined();
      expect(token.split(".").length).not.toBe(3);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should generate different tokens on each call (random IV)", () => {
      const token1 = repository.issueToken("access", 3600, TEST_USER_ID);
      const token2 = repository.issueToken("access", 3600, TEST_USER_ID);
      expect(token1).not.toBe(token2);
    });

    it("should verify a valid access token and return the user", async () => {
      const token = repository.issueToken("access", 3600, TEST_USER_ID);
      const user = await repository.verifyAccessToken(token);

      expect(user).toBeDefined();
      expect(user?.id).toBe(TEST_USER_ID);
    });

    it("should return undefined for an expired access token", async () => {
      // Token that expired 1 second ago
      const token = repository.issueToken("access", -1, TEST_USER_ID);
      const user = await repository.verifyAccessToken(token);

      expect(user).toBeUndefined();
    });

    it("should return undefined for a refresh token used as access token", async () => {
      const refreshToken = repository.issueToken("refresh", 3600, TEST_USER_ID);
      const user = await repository.verifyAccessToken(refreshToken);

      // Wrong token type — must be rejected
      expect(user).toBeUndefined();
    });

    it("should return undefined for a tampered token", async () => {
      const token = repository.issueToken("access", 3600, TEST_USER_ID);
      // Modify the last 4 characters to simulate tampering
      const tampered = token.slice(0, -4) + "AAAA";
      const user = await repository.verifyAccessToken(tampered);

      expect(user).toBeUndefined();
    });

    it("should return undefined for a random string", async () => {
      const user = await repository.verifyAccessToken("not-a-valid-token");
      expect(user).toBeUndefined();
    });

    it("should return undefined for an empty token", async () => {
      const user = await repository.verifyAccessToken("");
      expect(user).toBeUndefined();
    });

    it("should reject a JWT-format access token (old format no longer accepted)", async () => {
      // Old format: JWT signed with JWT_SECRET — should be rejected by opaque verifier
      const oldJwt = jwt.sign(
        { typ: "access", sub: TEST_USER_ID },
        JWT_SECRET,
        { expiresIn: "1h" }
      );
      const user = await repository.verifyAccessToken(oldJwt);
      expect(user).toBeUndefined();
    });
  });

  describe("Multi-User Isolation", () => {
    it("should generate different tokens for different users", () => {
      const token1 = repository.issueToken("access", 3600, "user-1" as UserId);
      const token2 = repository.issueToken("access", 3600, "user-2" as UserId);
      expect(token1).not.toBe(token2);
    });

    it("should verify each token for the correct user", async () => {
      const sqliteDatabase = new (Database as unknown as typeof Database)(
        ":memory:"
      );
      sqliteDatabase.exec(`
        CREATE TABLE IF NOT EXISTS "user" (
          "id" TEXT PRIMARY KEY,
          "username" TEXT NOT NULL,
          "client_token" TEXT NOT NULL UNIQUE,
          "created_at" INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "sessions" (
          "sid" TEXT PRIMARY KEY,
          "sess" TEXT NOT NULL,
          "expire" TEXT NOT NULL
        );
      `);
      sqliteDatabase
        .prepare(
          `INSERT INTO "user" (id, username, client_token, created_at) VALUES (?, ?, ?, ?)`
        )
        .run("user-1", "user1@example.com", "token-1", Date.now());
      sqliteDatabase
        .prepare(
          `INSERT INTO "user" (id, username, client_token, created_at) VALUES (?, ?, ?, ?)`
        )
        .run("user-2", "user2@example.com", "token-2", Date.now());

      const repo = new UserRepository(sqliteDatabase, JWT_SECRET);
      const accessToken1 = repo.issueToken("access", 3600, "user-1" as UserId);
      const accessToken2 = repo.issueToken("access", 3600, "user-2" as UserId);

      const result1 = await repo.verifyAccessToken(accessToken1);
      const result2 = await repo.verifyAccessToken(accessToken2);

      expect(result1?.id).toBe("user-1");
      expect(result2?.id).toBe("user-2");
    });
  });

  describe("Token Exchange", () => {
    it("exchangeCode should return opaque access+refresh tokens", async () => {
      const code = repository.issueCode(TEST_USER_ID);

      const result = await repository.exchangeCode(code);

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      const [accessToken, refreshToken] = result!;

      // Neither should look like a JWT
      expect(accessToken.split(".").length).not.toBe(3);
      expect(refreshToken.split(".").length).not.toBe(3);

      // Access token should verify and return the correct user
      const user = await repository.verifyAccessToken(accessToken);
      expect(user?.id).toBe(TEST_USER_ID);
    });

    it("exchangeRefreshToken should return new opaque access+refresh tokens", async () => {
      const refreshToken = repository.issueToken(
        "refresh",
        86_400,
        TEST_USER_ID
      );

      const result = await repository.exchangeRefreshToken(refreshToken);

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      const [newAccess] = result!;

      const user = await repository.verifyAccessToken(newAccess);
      expect(user?.id).toBe(TEST_USER_ID);
    });

    it("exchangeRefreshToken should reject an invalid token", async () => {
      const result = await repository.exchangeRefreshToken("invalid-token");
      expect(result).toBeUndefined();
    });

    it("exchangeRefreshToken should reject an expired refresh token", async () => {
      const expired = repository.issueToken("refresh", -1, TEST_USER_ID);
      const result = await repository.exchangeRefreshToken(expired);
      expect(result).toBeUndefined();
    });
  });
});
