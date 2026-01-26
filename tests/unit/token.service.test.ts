import * as bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import {
  closeDatabase,
  getDrizzle,
  initializeDatabase,
} from "../../src/db/index.ts";
import { UserRepository } from "../../src/db/repositories/user.repository.ts";
import { authCodes, refreshTokens, users } from "../../src/db/schema.ts";
import { TokenService } from "../../src/services/token.service.ts";

// Set test database URL
process.env.DATABASE_URL = "file:./prisma/test-token.db";

describe("TokenService", () => {
  let tokenService: TokenService;
  let testUserId: string;
  const userRepository = new UserRepository();

  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);

    const db = getDrizzle();

    // Ensure clean slate
    await db.delete(refreshTokens);
    await db.delete(authCodes);
    await db.delete(users);

    // Create test user
    const user = await userRepository.create(
      "tokentest",
      await bcrypt.hash("password", 10),
      "test-token-" + Date.now()
    );
    testUserId = user.id;
  });

  afterAll(async () => {
    const db = getDrizzle();
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, testUserId));
    await db.delete(authCodes).where(eq(authCodes.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
    await closeDatabase();
  });

  beforeEach(() => {
    tokenService = new TokenService("test-secret", "1h", "30d");
  });

  describe("Access Token", () => {
    it("should generate valid access token", () => {
      const token = tokenService.generateAccessToken(testUserId);
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
    });

    it("should verify valid access token", () => {
      const token = tokenService.generateAccessToken(testUserId);
      const payload = tokenService.verifyAccessToken(token);

      expect(payload).toBeTruthy();
      expect(payload?.userId).toBe(testUserId);
      expect(payload?.type).toBe("access");
    });

    it("should reject invalid access token", () => {
      const payload = tokenService.verifyAccessToken("invalid-token");
      expect(payload).toBeNull();
    });

    it("should reject refresh token as access token", async () => {
      const refreshToken = await tokenService.generateRefreshToken(testUserId);
      const payload = tokenService.verifyAccessToken(refreshToken);
      expect(payload).toBeNull();
    });
  });

  describe("Refresh Token", () => {
    it("should generate valid refresh token", async () => {
      const token = await tokenService.generateRefreshToken(testUserId);
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
    });

    it("should verify valid refresh token", async () => {
      const token = await tokenService.generateRefreshToken(testUserId);
      const payload = await tokenService.verifyRefreshToken(token);

      expect(payload).toBeTruthy();
      expect(payload?.userId).toBe(testUserId);
      expect(payload?.type).toBe("refresh");
      expect(payload?.tokenId).toBeTruthy();
    });

    it("should reject invalid refresh token", async () => {
      const payload = await tokenService.verifyRefreshToken("invalid-token");
      expect(payload).toBeNull();
    });

    it("should reject revoked refresh token", async () => {
      const token = await tokenService.generateRefreshToken(testUserId);
      const payload = await tokenService.verifyRefreshToken(token);

      expect(payload).toBeTruthy();

      // Revoke the token
      await tokenService.revokeRefreshToken(payload!.tokenId);

      // Should now be invalid
      const verifyResult = await tokenService.verifyRefreshToken(token);
      expect(verifyResult).toBeNull();
    });

    it("should revoke all user tokens", async () => {
      const token1 = await tokenService.generateRefreshToken(testUserId);
      const token2 = await tokenService.generateRefreshToken(testUserId);

      // Both should be valid
      expect(await tokenService.verifyRefreshToken(token1)).toBeTruthy();
      expect(await tokenService.verifyRefreshToken(token2)).toBeTruthy();

      // Revoke all
      await tokenService.revokeAllUserTokens(testUserId);

      // Both should now be invalid
      expect(await tokenService.verifyRefreshToken(token1)).toBeNull();
      expect(await tokenService.verifyRefreshToken(token2)).toBeNull();
    });
  });

  describe("Authorization Code", () => {
    const clientId = "test-client-id";
    const redirectUri = "https://example.com/callback";

    it("should create authorization code", async () => {
      const code = await tokenService.createAuthCode(
        testUserId,
        clientId,
        redirectUri
      );
      expect(code).toBeTruthy();
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });

    it("should validate and consume valid auth code", async () => {
      const code = await tokenService.createAuthCode(
        testUserId,
        clientId,
        redirectUri
      );
      const userId = await tokenService.validateAuthCode(
        code,
        clientId,
        redirectUri
      );

      expect(userId).toBe(testUserId);
    });

    it("should reject auth code with wrong client ID", async () => {
      const code = await tokenService.createAuthCode(
        testUserId,
        clientId,
        redirectUri
      );
      const userId = await tokenService.validateAuthCode(
        code,
        "wrong-client",
        redirectUri
      );

      expect(userId).toBeNull();
    });

    it("should reject auth code with wrong redirect URI", async () => {
      const code = await tokenService.createAuthCode(
        testUserId,
        clientId,
        redirectUri
      );
      const userId = await tokenService.validateAuthCode(
        code,
        clientId,
        "https://wrong.com"
      );

      expect(userId).toBeNull();
    });

    it("should reject invalid auth code", async () => {
      const userId = await tokenService.validateAuthCode(
        "invalid-code",
        clientId,
        redirectUri
      );
      expect(userId).toBeNull();
    });

    it("should reject reused auth code", async () => {
      const code = await tokenService.createAuthCode(
        testUserId,
        clientId,
        redirectUri
      );

      // First use should succeed
      const userId1 = await tokenService.validateAuthCode(
        code,
        clientId,
        redirectUri
      );
      expect(userId1).toBe(testUserId);

      // Second use should fail (code consumed)
      const userId2 = await tokenService.validateAuthCode(
        code,
        clientId,
        redirectUri
      );
      expect(userId2).toBeNull();
    });

    it("should reject expired auth code", async () => {
      const code = await tokenService.createAuthCode(
        testUserId,
        clientId,
        redirectUri
      );

      // Manually expire the code by updating database
      const db = getDrizzle();
      await db
        .update(authCodes)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(authCodes.code, code));

      const userId = await tokenService.validateAuthCode(
        code,
        clientId,
        redirectUri
      );
      expect(userId).toBeNull();
    });
  });
});
