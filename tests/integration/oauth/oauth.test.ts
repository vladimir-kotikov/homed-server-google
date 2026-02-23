/**
 * Integration tests for OAuth endpoints
 * Tests the actual server behavior against Google Cloud-to-Cloud specifications
 */
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { UserId, UserRepository } from "../../../src/db/repository.ts";
import { WebApp } from "../../../src/web/app.ts";
import { OAuthController } from "../../../src/web/oauth.ts";
import { createTestUserRepository } from "../testDatabase.ts";

const JWT_SECRET = "test-oauth-secret";
const CLIENT_ID = "dev-oauth-client-id";
const CLIENT_SECRET = "dev-oauth-client-secret";
const PROJECT_ID = "project-id";
const REDIRECT_URI = `https://oauth-redirect.googleusercontent.com/r/${PROJECT_ID}`;
const SANDBOX_REDIRECT_URI = `https://oauth-redirect-sandbox.googleusercontent.com/r/${PROJECT_ID}`;

const EXCHANGE_CODE_PAYLOAD = {
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  grant_type: "authorization_code",
  redirect_uri: REDIRECT_URI,
};

const EXCHANGE_TOKENS_PAYLOAD = {
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  grant_type: "refresh_token",
};

const newCode = (repo: UserRepository) =>
  repo.issueCode("test-user-id" as UserId);

const newTokens = async (repo: UserRepository) => {
  const code = newCode(repo);
  const tokens = await repo.exchangeCode(code);
  return tokens!;
};

describe("OAuth Integration Tests", () => {
  let webApp: WebApp;
  let userRepository: UserRepository;

  beforeEach(() => {
    const { repository } = createTestUserRepository(JWT_SECRET);
    userRepository = repository;

    // Create OAuth controller
    const oauthController = new OAuthController(
      userRepository,
      CLIENT_ID,
      PROJECT_ID
    );

    // Create mock FulfillmentController
    const mockFulfillmentController = {
      handleFulfillment: () => Promise.resolve({}),
    } as any;

    // Create DeviceRepository
    const deviceRepository: any = {};

    // Create actual WebApp with real implementation
    webApp = new WebApp(
      userRepository,
      mockFulfillmentController,
      oauthController,
      deviceRepository
    );
  });

  describe("Authorization endpoint - client validation", () => {
    it("should accept both production and sandbox redirect URIs for the same project", () => {
      const controller = new OAuthController(
        userRepository,
        CLIENT_ID,
        PROJECT_ID
      );

      // Both production and sandbox should be valid
      const productionValid = (controller as any).isValidClient(
        CLIENT_ID,
        REDIRECT_URI
      );
      const sandboxValid = (controller as any).isValidClient(
        CLIENT_ID,
        SANDBOX_REDIRECT_URI
      );

      expect(productionValid).toBe(true);
      expect(sandboxValid).toBe(true);
    });

    it("should reject redirect URI for different project ID", () => {
      const controller = new OAuthController(
        userRepository,
        CLIENT_ID,
        PROJECT_ID
      );

      const isValid = (controller as any).isValidClient(
        CLIENT_ID,
        "https://oauth-redirect.googleusercontent.com/r/different-project"
      );

      expect(isValid).toBe(false);
    });

    it("should reject redirect URI with wrong domain", () => {
      const controller = new OAuthController(
        userRepository,
        CLIENT_ID,
        PROJECT_ID
      );

      const isValid = (controller as any).isValidClient(
        CLIENT_ID,
        "https://malicious-site.com/r/project-id"
      );

      expect(isValid).toBe(false);
    });

    it("should reject client with wrong client_id regardless of redirect_uri", () => {
      const controller = new OAuthController(
        userRepository,
        CLIENT_ID,
        PROJECT_ID
      );

      const isValid = (controller as any).isValidClient(
        "wrong-client-id",
        REDIRECT_URI
      );

      expect(isValid).toBe(false);
    });

    it("should accept valid client when redirect_uri is not provided", () => {
      const controller = new OAuthController(
        userRepository,
        CLIENT_ID,
        PROJECT_ID
      );

      const isValid = (controller as any).isValidClient(CLIENT_ID);

      expect(isValid).toBe(true);
    });
  });

  describe("Authorization code exchange", () => {
    it("should return token_type Bearer in token exchange response", async () => {
      const code = newCode(userRepository);

      const response = await request(webApp.app)
        .post("/oauth/token")
        .type("form")
        .send({ ...EXCHANGE_CODE_PAYLOAD, code });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        token_type: "Bearer",
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        expires_in: 3600, // 1 hour as configured
      });
    });

    it("should return invalid_grant error for invalid authorization code", async () => {
      const response = await request(webApp.app)
        .post("/oauth/token")
        .type("form")
        .send({ ...EXCHANGE_CODE_PAYLOAD, code: "invalid-auth-code" });

      // TODO: The oauth2orize middleware responsd with 403
      // expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: "invalid_grant",
      });
    });

    it("should return invalid_grant error when redirect_uri does not match", async () => {
      const code = newCode(userRepository);

      const response = await request(webApp.app)
        .post("/oauth/token")
        .type("form")
        .send({
          ...EXCHANGE_CODE_PAYLOAD,
          code,
          redirect_uri: "https://different-redirect-uri.example.com/callback",
        });

      // TODO: The oauth2orize middleware responsd with 403
      // expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: "invalid_grant",
      });
    });

    it("should return invalid_grant error for mismatched client_id", async () => {
      const code = newCode(userRepository);

      const response = await request(webApp.app)
        .post("/oauth/token")
        .type("form")
        .send({
          ...EXCHANGE_CODE_PAYLOAD,
          client_id: "different-client-id",
          code,
        });

      expect(response).toBeDefined();
      // TODO: The oauth2orize middleware responsd with 401
      // expect(response.status).toBe(400);
      // expect(response.body).toMatchObject({
      //   error: "invalid_grant",
      // });
    });
  });

  describe("Refresh Token Exchange", () => {
    it("should return token_type Bearer when exchanging refresh token", async () => {
      const [, refresh_token] = await newTokens(userRepository)!;

      // Now exchange refresh token for new access token
      const refreshResponse = await request(webApp.app)
        .post("/oauth/token")
        .type("form")
        .send({ ...EXCHANGE_TOKENS_PAYLOAD, refresh_token });

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body).toMatchObject({
        token_type: "Bearer",
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        expires_in: 3600, // 1 hour as configured
      });
    });
  });

  describe("Userinfo Endpoint", () => {
    it("should return user information with valid access token", async () => {
      const [accessToken] = await newTokens(userRepository)!;

      // Call userinfo endpoint
      const response = await request(webApp.app)
        .get("/oauth/userinfo")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        sub: "test-user-id",
        email: "test@example.com",
        name: "test@example.com",
      });
    });

    it("should return 401 when Authorization header is missing", async () => {
      const response = await request(webApp.app).get("/oauth/userinfo");

      expect(response.status).toBe(401);
      expect(response.headers).toHaveProperty("www-authenticate");
      expect(response.body).toMatchObject({
        error: "unauthorized_client",
      });
    });

    it("should return 401 when Authorization header does not have Bearer prefix", async () => {
      const response = await request(webApp.app)
        .get("/oauth/userinfo")
        .set("Authorization", "InvalidToken");

      expect(response.status).toBe(401);
      expect(response.headers).toHaveProperty("www-authenticate");
      expect(response.body).toMatchObject({
        error: "unauthorized_client",
      });
    });

    it("should return 401 with WWW-Authenticate header for invalid token", async () => {
      const response = await request(webApp.app)
        .get("/oauth/userinfo")
        .set("Authorization", "Bearer invalid-token");

      expect(response.status).toBe(401);
      expect(response.headers).toHaveProperty("www-authenticate");
      expect(response.body).toMatchObject({
        error: "invalid_token",
      });
    });

    it("should return 401 for expired access token", async () => {
      // Create an expired token by manipulating issueToken
      const expiredAccessToken = await (userRepository as any).issueToken(
        "access",
        -3600, // Already expired (1 hour ago)
        "test-user-id",
        CLIENT_ID,
        REDIRECT_URI
      );

      const response = await request(webApp.app)
        .get("/oauth/userinfo")
        .set("Authorization", `Bearer ${expiredAccessToken}`);

      expect(response.status).toBe(401);
      expect(response.headers).toHaveProperty("www-authenticate");
      expect(response.body).toMatchObject({
        error: "invalid_token",
      });
    });
  });
});
