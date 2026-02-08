import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "../../src/db/repository.ts";
import { HomeGraphClient } from "../../src/google/homeGraph.ts";
import { toGoogleDeviceId } from "../../src/google/mapper.ts";
import type { GoogleDeviceState } from "../../src/google/types.ts";
import type { ClientId } from "../../src/homed/client.ts";

const createUserId = (id: string): UserId => id as UserId;
const createClientId = (id: string): ClientId => id as ClientId;

// Mock googleapis
let mockGetClient = vi.fn();
let mockGetProjectId = vi.fn();

vi.mock("googleapis", () => {
  return {
    google: {
      auth: {
        GoogleAuth: vi.fn(function (this: any) {
          this.getClient = mockGetClient;
          this.getProjectId = mockGetProjectId;
          return this;
        }),
      },
      homegraph: vi.fn(),
    },
  };
});

describe("HomeGraphClient", () => {
  const userId = createUserId("user1");
  const clientId = createClientId("client1");
  const deviceId = "device1";
  const testProjectId = "test-project";

  const setupAuthMock = async () => {
    mockGetClient = vi.fn().mockResolvedValue({});
    mockGetProjectId = vi.fn().mockResolvedValue(testProjectId);
    return { getClient: mockGetClient, getProjectId: mockGetProjectId };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize HomeGraph client", async () => {
      const { google } = await import("googleapis");

      new HomeGraphClient();

      expect(google.homegraph).toHaveBeenCalledWith("v1");
    });
  });

  describe("reportStateChange", () => {
    it("should call HomeGraph reportStateAndNotification with correct payload", async () => {
      const { google } = await import("googleapis");
      await setupAuthMock();

      const mockReportStateAndNotification = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient();
      await new Promise(resolve => setTimeout(resolve, 0));

      const state: GoogleDeviceState = {
        online: true,
        on: true,
        brightness: 80,
      };

      const googleDeviceId = toGoogleDeviceId(clientId, deviceId);
      await client.reportStateChange(userId, [{ googleDeviceId, state }]);

      expect(mockReportStateAndNotification).toHaveBeenCalledWith({
        requestBody: {
          agentUserId: userId,
          requestId: expect.any(String),
          payload: {
            devices: {
              states: {
                [googleDeviceId]: state,
              },
            },
          },
        },
      });
    });

    it("should batch multiple device states in a single API call", async () => {
      const { google } = await import("googleapis");
      await setupAuthMock();

      const mockReportStateAndNotification = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient();
      await new Promise(resolve => setTimeout(resolve, 0));

      const device1Id = toGoogleDeviceId(clientId, "device1");
      const device2Id = toGoogleDeviceId(clientId, "device2");
      const device3Id = toGoogleDeviceId(clientId, "device3");

      const state1: GoogleDeviceState = { online: true, on: true };
      const state2: GoogleDeviceState = { online: true, on: false };
      const state3: GoogleDeviceState = { online: true, brightness: 50 };

      await client.reportStateChange(userId, [
        { googleDeviceId: device1Id, state: state1 },
        { googleDeviceId: device2Id, state: state2 },
        { googleDeviceId: device3Id, state: state3 },
      ]);

      // Should have called API only once with all three devices
      expect(mockReportStateAndNotification).toHaveBeenCalledTimes(1);
      expect(mockReportStateAndNotification).toHaveBeenCalledWith({
        requestBody: {
          agentUserId: userId,
          requestId: expect.any(String),
          payload: {
            devices: {
              states: {
                [device1Id]: state1,
                [device2Id]: state2,
                [device3Id]: state3,
              },
            },
          },
        },
      });
    });

    it("should format device ID correctly as agentUserId-deviceKey", async () => {
      const { google } = await import("googleapis");
      await setupAuthMock();

      const mockReportStateAndNotification = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient();
      await new Promise(resolve => setTimeout(resolve, 0));

      const state: GoogleDeviceState = { online: true, on: false };
      const testUserId = createUserId("testUser123");
      const testClientId = createClientId("testClient123");
      const testDeviceId = "testDevice456";

      const googleDeviceId = toGoogleDeviceId(testClientId, testDeviceId);
      await client.reportStateChange(testUserId, [{ googleDeviceId, state }]);

      expect(mockReportStateAndNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            payload: {
              devices: {
                states: {
                  [googleDeviceId]: state,
                },
              },
            },
          }),
        })
      );
    });

    it("should handle empty batch gracefully without API call", async () => {
      const { google } = await import("googleapis");
      await setupAuthMock();

      const mockReportStateAndNotification = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: mockReportStateAndNotification,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient();
      await new Promise(resolve => setTimeout(resolve, 0));

      await client.reportStateChange(userId, []);

      // Should not call API for empty batch
      expect(mockReportStateAndNotification).not.toHaveBeenCalled();
    });
  });

  describe("updateDevices", () => {
    it("should call HomeGraph requestSync with correct payload", async () => {
      const { google } = await import("googleapis");
      await setupAuthMock();

      const mockRequestSync = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: vi.fn(),
          requestSync: mockRequestSync,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient();
      await new Promise(resolve => setTimeout(resolve, 0));

      await client.updateDevices(userId);

      expect(mockRequestSync).toHaveBeenCalledWith({
        requestBody: {
          agentUserId: userId,
          async: true,
        },
      });
    });

    it("should handle updates for different users independently", async () => {
      const { google } = await import("googleapis");
      await setupAuthMock();

      const mockRequestSync = vi.fn().mockResolvedValue({});
      const mockHomegraph = {
        devices: {
          reportStateAndNotification: vi.fn(),
          requestSync: mockRequestSync,
        },
      };
      vi.mocked(google.homegraph).mockReturnValue(mockHomegraph as never);

      const client = new HomeGraphClient();
      await new Promise(resolve => setTimeout(resolve, 0));

      const userId2 = createUserId("user2");

      // Send updates for different users
      await client.updateDevices(userId);
      await client.updateDevices(userId2);

      // Should have called API twice - once for each user
      expect(mockRequestSync).toHaveBeenCalledTimes(2);
      expect(mockRequestSync).toHaveBeenCalledWith({
        requestBody: {
          agentUserId: userId,
          async: true,
        },
      });
      expect(mockRequestSync).toHaveBeenCalledWith({
        requestBody: {
          agentUserId: userId2,
          async: true,
        },
      });
    });
  });
});
