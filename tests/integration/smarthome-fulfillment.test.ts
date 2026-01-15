/**
 * Integration test: Smart Home Fulfillment
 * Tests all four Google Smart Home intents with authentication
 */

import request from "supertest";
import { readTestConfig } from "./test-utils.ts";

const BASE_URL = "http://localhost:8080";
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "test-client-id";
const OAUTH_CLIENT_SECRET =
  process.env.OAUTH_CLIENT_SECRET || "test-client-secret";
const REDIRECT_URI =
  "https://oauth-redirect.googleusercontent.com/r/test-project";

describe("Smart Home Fulfillment", () => {
  let testConfig: { username: string; password: string; clientToken: string };
  let accessToken: string;

  beforeAll(async () => {
    try {
      testConfig = readTestConfig();
      console.log("📋 Test configuration loaded");
    } catch {
      throw new Error("Test configuration not found. Run: npm run seed:test");
    }

    // Get access token for all tests
    const authResponse = await request(BASE_URL).post("/oauth/authorize").send({
      username: testConfig.username,
      password: testConfig.password,
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    });

    const redirectUrl = new URL(authResponse.body.redirect_uri);
    const authCode = redirectUrl.searchParams.get("code")!;

    const tokenResponse = await request(BASE_URL).post("/oauth/token").send({
      grant_type: "authorization_code",
      code: authCode,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    accessToken = tokenResponse.body.access_token;
    console.log("✅ Access token obtained for fulfillment tests");
  });

  describe("SYNC Intent", () => {
    it("should return device list from connected TCP client", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "sync-request-1",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("requestId", "sync-request-1");
      expect(response.body).toHaveProperty("payload");
      expect(response.body.payload).toHaveProperty("agentUserId");
      expect(response.body.payload).toHaveProperty("devices");
      expect(Array.isArray(response.body.payload.devices)).toBe(true);
    });

    it("should return valid device structure", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "sync-request-2",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(response.status).toBe(200);

      if (response.body.payload.devices.length > 0) {
        const device = response.body.payload.devices[0];
        expect(device).toHaveProperty("id");
        expect(device).toHaveProperty("type");
        expect(device).toHaveProperty("traits");
        expect(device).toHaveProperty("name");
        expect(device).toHaveProperty("willReportState");
        expect(Array.isArray(device.traits)).toBe(true);
        expect(device.name).toHaveProperty("name");
      }
    });
  });

  describe("QUERY Intent", () => {
    it("should query device states", async () => {
      // First get devices from SYNC
      const syncResponse = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "sync-for-query",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      const devices = syncResponse.body.payload.devices;

      if (devices.length > 0) {
        const deviceId = devices[0].id;

        const response = await request(BASE_URL)
          .post("/fulfillment")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({
            requestId: "query-request-1",
            inputs: [
              {
                intent: "action.devices.QUERY",
                payload: {
                  devices: [{ id: deviceId }],
                },
              },
            ],
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("requestId", "query-request-1");
        expect(response.body).toHaveProperty("payload");
        expect(response.body.payload).toHaveProperty("devices");
        expect(response.body.payload.devices).toHaveProperty(deviceId);
        expect(response.body.payload.devices[deviceId]).toHaveProperty(
          "online"
        );
      } else {
        console.warn("⚠️  No devices available for QUERY test");
      }
    });

    it("should handle multiple device queries", async () => {
      const syncResponse = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "sync-for-multi-query",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      const devices = syncResponse.body.payload.devices;

      if (devices.length >= 2) {
        const deviceIds = devices.slice(0, 2).map((d: any) => d.id);

        const response = await request(BASE_URL)
          .post("/fulfillment")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({
            requestId: "query-request-2",
            inputs: [
              {
                intent: "action.devices.QUERY",
                payload: {
                  devices: deviceIds.map((id: string) => ({ id })),
                },
              },
            ],
          });

        expect(response.status).toBe(200);

        for (const deviceId of deviceIds) {
          expect(response.body.payload.devices).toHaveProperty(deviceId);
        }
      } else {
        console.warn("⚠️  Not enough devices for multi-device QUERY test");
      }
    });

    it("should return offline status for non-existent device", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "query-request-3",
          inputs: [
            {
              intent: "action.devices.QUERY",
              payload: {
                devices: [{ id: "non-existent-device-123" }],
              },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.payload.devices["non-existent-device-123"]).toEqual({
        online: false,
        status: "OFFLINE",
      });
    });
  });

  describe("EXECUTE Intent", () => {
    it("should execute command on device", async () => {
      const syncResponse = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "sync-for-execute",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      const devices = syncResponse.body.payload.devices;

      if (devices.length > 0) {
        const deviceId = devices[0].id;

        const response = await request(BASE_URL)
          .post("/fulfillment")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({
            requestId: "execute-request-1",
            inputs: [
              {
                intent: "action.devices.EXECUTE",
                payload: {
                  commands: [
                    {
                      devices: [{ id: deviceId }],
                      execution: [
                        {
                          command: "action.devices.commands.OnOff",
                          params: { on: true },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("requestId", "execute-request-1");
        expect(response.body).toHaveProperty("payload");
        expect(response.body.payload).toHaveProperty("commands");
        expect(Array.isArray(response.body.payload.commands)).toBe(true);
        expect(response.body.payload.commands.length).toBeGreaterThan(0);

        const result = response.body.payload.commands[0];
        expect(result).toHaveProperty("ids");
        expect(result).toHaveProperty("status");
        expect(result.ids).toContain(deviceId);
        expect(["SUCCESS", "ERROR", "PENDING"]).toContain(result.status);
      } else {
        console.warn("⚠️  No devices available for EXECUTE test");
      }
    });

    it("should handle multiple device commands", async () => {
      const syncResponse = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "sync-for-multi-execute",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      const devices = syncResponse.body.payload.devices;

      if (devices.length >= 2) {
        const deviceIds = devices.slice(0, 2).map((d: any) => d.id);

        const response = await request(BASE_URL)
          .post("/fulfillment")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({
            requestId: "execute-request-2",
            inputs: [
              {
                intent: "action.devices.EXECUTE",
                payload: {
                  commands: [
                    {
                      devices: deviceIds.map((id: string) => ({ id })),
                      execution: [
                        {
                          command: "action.devices.commands.OnOff",
                          params: { on: false },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          });

        expect(response.status).toBe(200);
        expect(response.body.payload.commands.length).toBeGreaterThan(0);
      } else {
        console.warn("⚠️  Not enough devices for multi-device EXECUTE test");
      }
    });

    it("should handle command with parameters", async () => {
      const syncResponse = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "sync-for-params",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      const devices = syncResponse.body.payload.devices;

      if (devices.length > 0) {
        const deviceId = devices[0].id;

        const response = await request(BASE_URL)
          .post("/fulfillment")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({
            requestId: "execute-request-3",
            inputs: [
              {
                intent: "action.devices.EXECUTE",
                payload: {
                  commands: [
                    {
                      devices: [{ id: deviceId }],
                      execution: [
                        {
                          command: "action.devices.commands.BrightnessAbsolute",
                          params: { brightness: 75 },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          });

        expect(response.status).toBe(200);

        const result = response.body.payload.commands[0];
        if (result.status === "SUCCESS") {
          expect(result.states).toBeDefined();
        }
      }
    });
  });

  describe("DISCONNECT Intent", () => {
    it("should revoke user tokens on disconnect", async () => {
      // Get a separate access token for this test
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

      const tokenResponse = await request(BASE_URL).post("/oauth/token").send({
        grant_type: "authorization_code",
        code: authCode,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      });

      const disconnectToken = tokenResponse.body.access_token;
      const refreshToken = tokenResponse.body.refresh_token;

      // Verify token works
      const syncResponse = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${disconnectToken}`)
        .send({
          requestId: "sync-before-disconnect",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(syncResponse.status).toBe(200);

      // Call DISCONNECT
      const disconnectResponse = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${disconnectToken}`)
        .send({
          requestId: "disconnect-request-1",
          inputs: [{ intent: "action.devices.DISCONNECT" }],
        });

      expect(disconnectResponse.status).toBe(200);
      expect(disconnectResponse.body).toHaveProperty(
        "requestId",
        "disconnect-request-1"
      );
      expect(disconnectResponse.body).toHaveProperty("payload");

      // Try to use refresh token - should fail
      const refreshResponse = await request(BASE_URL)
        .post("/oauth/token")
        .send({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
        });

      expect(refreshResponse.status).toBe(400);
      expect(refreshResponse.body.error).toBe("invalid_grant");
    });
  });

  describe("Authentication", () => {
    it("should reject request without authorization header", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .send({
          requestId: "no-auth-request",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should reject request with invalid token", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", "Bearer invalid-token-xyz")
        .send({
          requestId: "invalid-auth-request",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should reject malformed authorization header", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", "InvalidFormat token123")
        .send({
          requestId: "malformed-auth-request",
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(response.status).toBe(401);
    });
  });

  describe("Request Validation", () => {
    it("should reject request without requestId", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          inputs: [{ intent: "action.devices.SYNC" }],
        });

      expect(response.status).toBe(400);
    });

    it("should reject request without inputs", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "no-inputs-request",
        });

      expect(response.status).toBe(400);
    });

    it("should reject unknown intent", async () => {
      const response = await request(BASE_URL)
        .post("/fulfillment")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          requestId: "unknown-intent-request",
          inputs: [{ intent: "action.devices.UNKNOWN" }],
        });

      expect(response.status).toBe(400);
    });
  });
});
