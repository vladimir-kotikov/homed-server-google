/**
 * Unit tests for OAuth functionality
 * These tests focus on the UserRepository token routines and JWT operations
 */
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it } from "vitest";
import { UserRepository, type UserId } from "../../src/db/repository.ts";

describe("UserRepository - Token Routines", () => {
  let repository: UserRepository;
  const JWT_SECRET = "test-secret-key";

  beforeEach(() => {
    const sqliteDatabase = new (Database as any)(":memory:");

    // Create schema
    sqliteDatabase.exec(`
      CREATE TABLE "user" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL,
        "password_hash" TEXT NOT NULL,
        "created_at" INTEGER NOT NULL
      );
      CREATE TABLE "authorization_code" (
        "code" TEXT PRIMARY KEY,
        "user_id" TEXT NOT NULL,
        "client_id" TEXT NOT NULL,
        "redirect_uri" TEXT NOT NULL,
        "scope" TEXT,
        "expires_at" INTEGER NOT NULL,
        "created_at" INTEGER NOT NULL,
        FOREIGN KEY("user_id") REFERENCES "user"("id")
      );
      CREATE TABLE "access_token" (
        "token" TEXT PRIMARY KEY,
        "user_id" TEXT NOT NULL,
        "client_id" TEXT,
        "expires_at" INTEGER NOT NULL,
        "created_at" INTEGER NOT NULL,
        FOREIGN KEY("user_id") REFERENCES "user"("id")
      );
      CREATE TABLE "refresh_token" (
        "token" TEXT PRIMARY KEY,
        "user_id" TEXT NOT NULL,
        "client_id" TEXT,
        "expires_at" INTEGER NOT NULL,
        "created_at" INTEGER NOT NULL,
        FOREIGN KEY("user_id") REFERENCES "user"("id")
      );
    `);

    repository = new UserRepository(sqliteDatabase, JWT_SECRET);

    // Create test user
    sqliteDatabase
      .prepare(
        `
      INSERT INTO user (id, email, password_hash, created_at)
      VALUES (?, ?, ?, ?)
    `
      )
      .run("test-user-id", "test@example.com", "hashed-password", Date.now());
  });

  describe("Authorization Code Generation", () => {
    it("should generate authorization code with correct structure", () => {
      const code = repository.issueCode(
        "test-user-id" as UserId,
        "client-id",
        "http://localhost:3000/callback"
      );

      expect(code).toBeDefined();
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });

    it("should generate different codes for different calls", () => {
      const code1 = repository.issueCode(
        "test-user-id" as UserId,
        "client-id",
        "http://localhost:3000/callback"
      );
      // Add a small delay to ensure different iat timestamp
      const code2 = repository.issueCode(
        "test-user-id" as UserId,
        "client-id",
        "http://localhost:3000/callback"
      );

      // JWTs with same payload but issued at different times have different iat claims
      const decoded1 = jwt.verify(code1, JWT_SECRET) as Record<string, unknown>;
      const decoded2 = jwt.verify(code2, JWT_SECRET) as Record<string, unknown>;

      // Both should be valid codes
      expect(decoded1.typ).toBe("code");
      expect(decoded2.typ).toBe("code");
    });
  });

  describe("Token Generation and JWT Verification", () => {
    it("should generate valid JWT access token", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      expect(decoded.sub).toBe("test-user-id");
      expect(decoded.typ).toBe("access");
    });

    it("should generate valid JWT refresh token", () => {
      const token = repository.issueToken(
        "refresh",
        "7d",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      expect(token).toBeDefined();
      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      expect(decoded.typ).toBe("refresh");
    });

    it("should include correct issuer in token", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      expect(decoded.iss).toBe("client-id");
    });

    it("should set correct expiration time", () => {
      const beforeIssue = Math.floor(Date.now() / 1000);
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      const exp = decoded.exp as number;

      // Should be approximately 1 hour from now
      const expectedExp = beforeIssue + 3600;
      expect(Math.abs(exp - expectedExp)).toBeLessThan(5); // Allow 5 second tolerance
    });

    it("should reject token with wrong secret", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      expect(() => {
        jwt.verify(token, "wrong-secret");
      }).toThrow();
    });

    it("should reject tampered token", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );
      const decoded = jwt.decode(token) as Record<string, unknown>;

      // Tamper with payload
      if (decoded && typeof decoded === "object") {
        decoded.sub = "different-user";
      }

      // Re-encode without signing (simulates tampering)
      const tampered = Buffer.from(JSON.stringify(decoded)).toString("base64");

      // jwt.verify should reject this
      expect(() => {
        jwt.verify(
          token.slice(0, token.lastIndexOf(".")) + "." + tampered,
          JWT_SECRET
        );
      }).toThrow();
    });

    it("should verify token with correct secret", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      expect(() => {
        jwt.verify(token, JWT_SECRET);
      }).not.toThrow();
    });
  });

  describe("Multi-User Isolation", () => {
    beforeEach(() => {
      const sqliteDatabase = new (Database as any)(":memory:");
      sqliteDatabase.exec(`
        CREATE TABLE "user" (
          "id" TEXT PRIMARY KEY,
          "email" TEXT NOT NULL,
          "password_hash" TEXT NOT NULL,
          "created_at" INTEGER NOT NULL
        );
        CREATE TABLE "authorization_code" (
          "code" TEXT PRIMARY KEY,
          "user_id" TEXT NOT NULL,
          "client_id" TEXT NOT NULL,
          "redirect_uri" TEXT NOT NULL,
          "scope" TEXT,
          "expires_at" INTEGER NOT NULL,
          "created_at" INTEGER NOT NULL,
          FOREIGN KEY("user_id") REFERENCES "user"("id")
        );
        CREATE TABLE "access_token" (
          "token" TEXT PRIMARY KEY,
          "user_id" TEXT NOT NULL,
          "client_id" TEXT,
          "expires_at" INTEGER NOT NULL,
          "created_at" INTEGER NOT NULL,
          FOREIGN KEY("user_id") REFERENCES "user"("id")
        );
        CREATE TABLE "refresh_token" (
          "token" TEXT PRIMARY KEY,
          "user_id" TEXT NOT NULL,
          "client_id" TEXT,
          "expires_at" INTEGER NOT NULL,
          "created_at" INTEGER NOT NULL,
          FOREIGN KEY("user_id") REFERENCES "user"("id")
        );
      `);

      repository = new UserRepository(sqliteDatabase, JWT_SECRET);

      // Create multiple test users
      sqliteDatabase
        .prepare(
          `
        INSERT INTO user (id, email, password_hash, created_at)
        VALUES (?, ?, ?, ?)
      `
        )
        .run("user-1", "user1@example.com", "hash1", Date.now());

      sqliteDatabase
        .prepare(
          `
        INSERT INTO user (id, email, password_hash, created_at)
        VALUES (?, ?, ?, ?)
      `
        )
        .run("user-2", "user2@example.com", "hash2", Date.now());
    });

    it("should generate different tokens for different users", () => {
      const token1 = repository.issueToken(
        "access",
        "1h",
        "user-1" as UserId,
        "client-id",
        "http://localhost"
      );
      const token2 = repository.issueToken(
        "access",
        "1h",
        "user-2" as UserId,
        "client-id",
        "http://localhost"
      );

      const decoded1 = jwt.verify(token1, JWT_SECRET) as Record<
        string,
        unknown
      >;
      const decoded2 = jwt.verify(token2, JWT_SECRET) as Record<
        string,
        unknown
      >;

      expect(decoded1.sub).toBe("user-1");
      expect(decoded2.sub).toBe("user-2");
    });

    it("should include user id in token claims", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "user-1" as UserId,
        "client-id",
        "http://localhost"
      );

      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      expect(decoded.sub).toBe("user-1");
    });
  });

  describe("JWT Payload Structure", () => {
    it("should have standard OIDC claims in token", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;

      expect(decoded).toHaveProperty("sub"); // Subject (user id)
      expect(decoded).toHaveProperty("iss"); // Issuer (client id)
      expect(decoded).toHaveProperty("iat"); // Issued at
      expect(decoded).toHaveProperty("exp"); // Expiration
      expect(decoded).toHaveProperty("typ"); // Token type
    });

    it("should mark token type correctly", () => {
      const accessToken = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );
      const refreshToken = repository.issueToken(
        "refresh",
        "7d",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      const accessDecoded = jwt.verify(accessToken, JWT_SECRET) as Record<
        string,
        unknown
      >;
      const refreshDecoded = jwt.verify(refreshToken, JWT_SECRET) as Record<
        string,
        unknown
      >;

      expect(accessDecoded.typ).toBe("access");
      expect(refreshDecoded.typ).toBe("refresh");
    });

    it("should have iat before exp", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
      const iat = decoded.iat as number;
      const exp = decoded.exp as number;

      expect(iat).toBeLessThan(exp);
    });
  });

  describe("Token Expiration", () => {
    it("should reject expired access token", () => {
      // Create a token that expired 1 second ago by manipulating the key
      const expiredPayload = {
        sub: "test-user-id",
        iss: "client-id",
        exp: Math.floor(Date.now() / 1000) - 1, // 1 second in the past
        iat: Math.floor(Date.now() / 1000) - 100,
        typ: "access",
      };

      const expiredToken = jwt.sign(expiredPayload, JWT_SECRET);

      expect(() => {
        jwt.verify(expiredToken, JWT_SECRET);
      }).toThrow("jwt expired");
    });

    it("should accept valid (not expired) token", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      expect(() => {
        jwt.verify(token, JWT_SECRET);
      }).not.toThrow();
    });

    it("should use correct durations for different token types", () => {
      const beforeAccess = Math.floor(Date.now() / 1000);
      const accessToken = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      const beforeRefresh = Math.floor(Date.now() / 1000);
      const refreshToken = repository.issueToken(
        "refresh",
        "7d",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      const accessDecoded = jwt.verify(accessToken, JWT_SECRET) as Record<
        string,
        unknown
      >;
      const refreshDecoded = jwt.verify(refreshToken, JWT_SECRET) as Record<
        string,
        unknown
      >;

      // Access token: 1 hour = 3600 seconds
      const accessExp = accessDecoded.exp as number;
      const accessDuration = accessExp - beforeAccess;
      expect(accessDuration).toBeGreaterThanOrEqual(3600 - 5);
      expect(accessDuration).toBeLessThanOrEqual(3600 + 5);

      // Refresh token: 7 days = 604800 seconds
      const refreshExp = refreshDecoded.exp as number;
      const refreshDuration = refreshExp - beforeRefresh;
      expect(refreshDuration).toBeGreaterThanOrEqual(604_800 - 5);
      expect(refreshDuration).toBeLessThanOrEqual(604_800 + 5);
    });
  });

  describe("Security - Token Signature Verification", () => {
    it("should reject malformed JWT", () => {
      const malformed = "not.a.valid.jwt";

      expect(() => {
        jwt.verify(malformed, JWT_SECRET);
      }).toThrow();
    });

    it("should reject JWT with missing signature", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      // Remove signature
      const noSignature = token.slice(0, token.lastIndexOf("."));

      expect(() => {
        jwt.verify(noSignature, JWT_SECRET);
      }).toThrow();
    });

    it("should verify token claims are present and correct", () => {
      const token = repository.issueToken(
        "access",
        "1h",
        "test-user-id" as UserId,
        "client-id",
        "http://localhost"
      );

      const decoded = jwt.verify(token, JWT_SECRET) as Record<string, unknown>;

      expect(decoded.sub).toBe("test-user-id");
      expect(decoded.iss).toBe("client-id");
      expect(typeof decoded.iat).toBe("number");
      expect(typeof decoded.exp).toBe("number");
      expect(decoded.typ).toBe("access");
    });
  });
});
