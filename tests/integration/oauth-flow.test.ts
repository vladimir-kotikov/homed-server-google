/**
 * Integration test: OAuth Authorization Flow
 * Tests the complete OAuth 2.0 authorization code flow
 */

import request from "supertest";
import { readTestConfig } from "./test-utils";

const BASE_URL = "http://localhost:8080";
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "test-client-id";
const OAUTH_CLIENT_SECRET =
  process.env.OAUTH_CLIENT_SECRET || "test-client-secret";
const REDIRECT_URI =
  "https://oauth-redirect.googleusercontent.com/r/test-project";

describe("OAuth Authorization Flow", () => {
  let testConfig: { username: string; password: string; clientToken: string };

  beforeAll(() => {
    try {
      testConfig = readTestConfig();
      console.log("📋 Test configuration loaded");
    } catch {
      throw new Error("Test configuration not found. Run: npm run seed:test");
    }
  });

  describe("Authorization Endpoint", () => {
    it("should return login page for GET /oauth/authorize", async () => {
      const response = await request(BASE_URL).get("/oauth/authorize").query({
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        state: "test-state-123",
      });

      expect(response.status).toBe(200);
      expect(response.type).toBe("text/html");
      expect(response.text).toContain("Sign in to Homed");
      expect(response.text).toContain("username");
      expect(response.text).toContain("password");
      expect(response.text).toContain(OAUTH_CLIENT_ID);
      expect(response.text).toContain(REDIRECT_URI);
    });

    it("should generate authorization code for valid credentials", async () => {
      const response = await request(BASE_URL).post("/oauth/authorize").send({
        username: testConfig.username,
        password: testConfig.password,
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        state: "test-state-456",
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("redirect_uri");

      const redirectUrl = new URL(response.body.redirect_uri);
      expect(redirectUrl.origin + redirectUrl.pathname).toBe(REDIRECT_URI);
      expect(redirectUrl.searchParams.has("code")).toBe(true);
      expect(redirectUrl.searchParams.get("state")).toBe("test-state-456");

      const code = redirectUrl.searchParams.get("code");
      expect(code).toBeTruthy();
      expect(code!.length).toBeGreaterThan(10);
    });

    it("should reject invalid credentials", async () => {
      const response = await request(BASE_URL).post("/oauth/authorize").send({
        username: testConfig.username,
        password: "wrong-password",
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("invalid_grant");
    });

    it("should reject missing username", async () => {
      const response = await request(BASE_URL).post("/oauth/authorize").send({
        password: testConfig.password,
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      });

      expect(response.status).toBe(401);
    });
  });

  describe("Token Endpoint", () => {
    let authCode: string;

    beforeEach(async () => {
      // Get fresh authorization code for each test
      const authResponse = await request(BASE_URL)
        .post("/oauth/authorize")
        .send({
          username: testConfig.username,
          password: testConfig.password,
          client_id: OAUTH_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
        });

      const redirectUrl = new URL(authResponse.body.redirect_uri);
      authCode = redirectUrl.searchParams.get("code")!;
    });

    it("should exchange authorization code for tokens", async () => {
      const response = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "authorization_code",
        code: authCode,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token_type", "Bearer");
      expect(response.body).toHaveProperty("access_token");
      expect(response.body).toHaveProperty("refresh_token");
      expect(response.body).toHaveProperty("expires_in");

      expect(typeof response.body.access_token).toBe("string");
      expect(typeof response.body.refresh_token).toBe("string");
      expect(response.body.expires_in).toBe(3600);
    });

    it("should reject invalid authorization code", async () => {
      const response = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "authorization_code",
        code: "invalid-code-xyz",
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("invalid_grant");
    });

    it("should reject reused authorization code", async () => {
      // First use - should succeed
      const firstResponse = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "authorization_code",
        code: authCode,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      });

      expect(firstResponse.status).toBe(200);

      // Second use - should fail
      const secondResponse = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "authorization_code",
        code: authCode,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      });

      expect(secondResponse.status).toBe(400);
      expect(secondResponse.body.error).toBe("invalid_grant");
    });

    it("should reject wrong client credentials", async () => {
      const response = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "authorization_code",
        code: authCode,
        client_id: OAUTH_CLIENT_ID,
        client_secret: "wrong-secret",
        redirect_uri: REDIRECT_URI,
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("invalid_client");
    });

    it("should refresh access token using refresh token", async () => {
      // Get initial tokens
      const tokenResponse = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "authorization_code",
        code: authCode,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      });

      const refreshToken = tokenResponse.body.refresh_token;

      // Small delay to ensure different token timestamps
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Use refresh token
      const refreshResponse = await request(BASE_URL)
        .post("/oauth/token")
        .send({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
        });

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body).toHaveProperty("token_type", "Bearer");
      expect(refreshResponse.body).toHaveProperty("access_token");
      expect(refreshResponse.body).toHaveProperty("expires_in", 3600);

      // Should get a different access token
      expect(refreshResponse.body.access_token).not.toBe(
        tokenResponse.body.access_token
      );
    });

    it("should reject invalid refresh token", async () => {
      const response = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "refresh_token",
        refresh_token: "invalid-refresh-token",
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("invalid_grant");
    });

    it("should reject unsupported grant type", async () => {
      const response = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "password",
        username: testConfig.username,
        password: testConfig.password,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("unsupported_grant_type");
    });
  });

  describe("Token Validation", () => {
    let accessToken: string;

    beforeEach(async () => {
      // Get authorization code
      const authResponse = await request(BASE_URL)
        .post("/oauth/authorize")
        .send({
          username: testConfig.username,
          password: testConfig.password,
          client_id: OAUTH_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
        });

      const redirectUrl = new URL(authResponse.body.redirect_uri);
      const authCode = redirectUrl.searchParams.get("code")!;

      // Exchange for token
      const tokenResponse = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "authorization_code",
        code: authCode,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      });

      accessToken = tokenResponse.body.access_token;
    });

    it("should accept valid access token for protected endpoint", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "test-request-id",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      // Should not return 401 (may return other errors if SYNC not fully implemented)
      expect(response.status).not.toBe(401);
    });

    it("should reject request without token", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .send({
          requestId: "test-request-id",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(response.status).toBe(401);
    });

    it("should reject invalid access token", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", "Bearer invalid-token")
        .send({
          requestId: "test-request-id",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(response.status).toBe(401);
    });
  });
});
