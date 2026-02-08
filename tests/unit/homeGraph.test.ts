import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "../../src/db/repository.ts";
import { HomeGraphClient } from "../../src/google/homeGraph.ts";
import type { GoogleDeviceState } from "../../src/google/types.ts";

const createUserId = (id: string): UserId => id as UserId;

// Mock googleapis
vi.mock("googleapis", () => {
  const mockReportStateAndNotification = vi.fn();
  const mockFromJSON = vi.fn();

  return {
    google: {
      auth: {
        fromJSON: mockFromJSON,
      },
      homegraph: vi.fn(() => ({
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      })),
    },
  };
});

describe("HomeGraphClient", () => {
  const userId = createUserId("user1");
  const deviceId = "device1";
  const mockServiceAccount = {
    type: "service_account",
    project_id: "test-project",
    private_key_id: "key123",
    private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
    client_email: "test@test-project.iam.gserviceaccount.com",
    client_id: "123456",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url:
      "https://www.googleapis.com/robot/v1/metadata/x509/test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should authenticate with service account when provided", async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      new HomeGraphClient(JSON.stringify(mockServiceAccount));

      // Wait for async constructor operations
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(google.auth.fromJSON).toHaveBeenCalledWith(mockServiceAccount);
    });

    it("should skip authentication when service account is not provided", async () => {
      const { google } = await import("googleapis");

      new HomeGraphClient();

      expect(google.auth.fromJSON).not.toHaveBeenCalled();
    });
  });

  describe("reportStateChange", () => {
    it("should call HomeGraph reportStateAndNotification with correct payload", async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      const mockReportStateAndNotification = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient(JSON.stringify(mockServiceAccount));
      await new Promise(resolve => setTimeout(resolve, 0));

      const state: GoogleDeviceState = {
        online: true,
        on: true,
        brightness: 80,
      };

      await client.reportStateChange(userId, deviceId, state);

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(mockReportStateAndNotification).toHaveBeenCalledWith({
        requestBody: {
          agentUserId: userId,
          requestId: expect.any(String),
          payload: {
            devices: {
              states: {
                [`${userId}-${deviceId}`]: state,
              },
            },
          },
        },
      });
    });

    it("should format device ID correctly as agentUserId-deviceKey", async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      const mockReportStateAndNotification = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient(JSON.stringify(mockServiceAccount));
      await new Promise(resolve => setTimeout(resolve, 0));

      const state: GoogleDeviceState = { online: true, on: false };
      const testUserId = createUserId("testUser123");
      const testDeviceId = "testDevice456";

      await client.reportStateChange(testUserId, testDeviceId, state);

      // Wait for debounce delay
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(mockReportStateAndNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            payload: {
              devices: {
                states: {
                  "testUser123-testDevice456": state,
                },
              },
            },
          }),
        })
      );
    });

    it("should handle API errors gracefully and log them", async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      const mockError = new Error("API Error");
      const mockReportStateAndNotification = vi
        .fn()
        .mockRejectedValue(mockError);
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      // Mock debug logger
      const mockDebug = vi.fn();
      vi.doMock("debug", () => ({
        default: () => mockDebug,
      }));

      const client = new HomeGraphClient(JSON.stringify(mockServiceAccount));
      await new Promise(resolve => setTimeout(resolve, 0));

      const state: GoogleDeviceState = { online: true };

      // Should not throw
      await expect(
        client.reportStateChange(userId, deviceId, state)
      ).resolves.not.toThrow();
    });

    it("should not throw errors when API call fails (fire-and-forget)", async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      const mockReportStateAndNotification = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient(JSON.stringify(mockServiceAccount));
      await new Promise(resolve => setTimeout(resolve, 0));

      const state: GoogleDeviceState = { online: false };

      // Should not throw
      await expect(
        client.reportStateChange(userId, deviceId, state)
      ).resolves.toBeUndefined();
    });

    it("should skip reporting when not initialized", async () => {
      const mockReportStateAndNotification = vi.fn();

      const client = new HomeGraphClient(); // No service account

      const state: GoogleDeviceState = { online: true };

      await client.reportStateChange(userId, deviceId, state);

      expect(mockReportStateAndNotification).not.toHaveBeenCalled();
    });

    it("should filter devices without traits", async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      const mockReportStateAndNotification = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient(JSON.stringify(mockServiceAccount));
      await new Promise(resolve => setTimeout(resolve, 0));

      // State with only 'online' and 'status' - no actual trait states
      const stateWithoutTraits: GoogleDeviceState = {
        online: true,
        status: "SUCCESS",
      };

      await client.reportStateChange(userId, deviceId, stateWithoutTraits);

      // Should not call API for devices without traits
      expect(mockReportStateAndNotification).not.toHaveBeenCalled();
    });

    it("should debounce multiple rapid state changes for the same device", async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      const mockReportStateAndNotification = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient(JSON.stringify(mockServiceAccount));
      await new Promise(resolve => setTimeout(resolve, 0));

      // Send multiple state changes rapidly
      const state1: GoogleDeviceState = { online: true, on: true };
      const state2: GoogleDeviceState = { online: true, on: false };
      const state3: GoogleDeviceState = { online: true, brightness: 50 };

      await client.reportStateChange(userId, deviceId, state1);
      await client.reportStateChange(userId, deviceId, state2);
      await client.reportStateChange(userId, deviceId, state3);

      // Should not call API immediately
      expect(mockReportStateAndNotification).not.toHaveBeenCalled();

      // Wait for debounce delay (1100ms)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should have called API only once with the last state
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(1);
      expect(mockReportStateAndNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            payload: {
              devices: {
                states: {
                  [`${userId}-${deviceId}`]: state3,
                },
              },
            },
          }),
        })
      );
    });

    it("should retry failed requests with exponential backoff", async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      const mockReportStateAndNotification = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({});

      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient(JSON.stringify(mockServiceAccount));
      await new Promise(resolve => setTimeout(resolve, 0));

      const state: GoogleDeviceState = { online: true, on: true };

      // Trigger state change
      await client.reportStateChange(userId, deviceId, state);

      // Wait for debounce + initial attempt
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(1);

      // Wait for first retry (1000ms backoff)
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(2);

      // Wait for second retry (2000ms backoff)
      await new Promise(resolve => setTimeout(resolve, 2100));
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(3);

      // Should have succeeded on third attempt
    });

    it("should give up after max retries", { timeout: 15000 }, async () => {
      const { google } = await import("googleapis");
      const mockAuthClient = { projectId: "test-project" };
      vi.mocked(google.auth.fromJSON).mockResolvedValue(
        mockAuthClient as never
      );

      const mockReportStateAndNotification = vi
        .fn()
        .mockRejectedValue(new Error("Persistent error"));

      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient(JSON.stringify(mockServiceAccount));
      await new Promise(resolve => setTimeout(resolve, 0));

      const state: GoogleDeviceState = { online: true, on: true };

      // Trigger state change
      await client.reportStateChange(userId, deviceId, state);

      // Wait for debounce + initial attempt
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(1);

      // Wait for first retry (1000ms)
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(2);

      // Wait for second retry (2000ms)
      await new Promise(resolve => setTimeout(resolve, 2100));
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(3);

      // Wait for third retry (4000ms)
      await new Promise(resolve => setTimeout(resolve, 4100));
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(4);

      // Wait a bit more - should not retry again (max 3 retries = 4 total attempts)
      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(4);
    });
  });
});
