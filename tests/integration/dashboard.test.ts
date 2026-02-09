/**
 * Integration tests for dashboard functionality
 * Tests the connected clients display and device repository integration
 */
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { DeviceId, HomedDevice } from "../../src/device.ts";
import { DeviceRepository } from "../../src/device.ts";
import type { ClientId } from "../../src/homed/client.ts";
import { WebApp } from "../../src/web/app.ts";
import { OAuthController } from "../../src/web/oauth.ts";
import { createTestUserRepository } from "./testDatabase.ts";

const JWT_SECRET = "test-secret";
const CLIENT_ID = "test-client-id";
const PROJECT_ID = "test-project";

describe("Dashboard - Connected Clients", () => {
  let webApp: WebApp;
  let deviceRepository: DeviceRepository;
  let userId: string;

  beforeEach(async () => {
    const { repository: userRepository, user } =
      createTestUserRepository(JWT_SECRET);
    userId = user.id;
    deviceRepository = new DeviceRepository();

    const oauthController = new OAuthController(
      userRepository,
      CLIENT_ID,
      PROJECT_ID
    );

    const mockFulfillmentController = {
      handleFulfillment: () => Promise.resolve({}),
    } as any;

    webApp = new WebApp(
      userRepository,
      mockFulfillmentController,
      oauthController,
      deviceRepository
    );
  });

  describe("GET /", () => {
    it("should redirect to login when not authenticated", async () => {
      await request(webApp.app).get("/").expect(302);
    });
  });

  describe("Device Repository Integration", () => {
    it("should return empty array when user has no connected clients", () => {
      const connectedClients = deviceRepository.getConnectedClientIds(
        userId as any
      );
      expect(connectedClients).toEqual([]);
    });

    it("should track client when devices are synced", () => {
      const clientId = "test-client" as ClientId;
      const mockDevice: HomedDevice = {
        key: "device-1" as DeviceId,
        topic: "device/1",
        name: "Test Device",
        available: true,
        endpoints: [],
      };

      deviceRepository.syncClientDevices(userId as any, clientId, [mockDevice]);

      const connectedClients = deviceRepository.getConnectedClientIds(
        userId as any
      );
      expect(connectedClients).toContain(clientId);
      expect(connectedClients.length).toBe(1);
    });

    it("should list all connected clients for a user", () => {
      const clientIds = ["client-1", "client-2", "client-3"] as ClientId[];
      const mockDevice: HomedDevice = {
        key: "test-device" as DeviceId,
        topic: "test/device",
        name: "Device",
        available: true,
        endpoints: [],
      };

      clientIds.forEach(clientId => {
        deviceRepository.syncClientDevices(userId as any, clientId, [
          mockDevice,
        ]);
      });

      const connectedClients = deviceRepository.getConnectedClientIds(
        userId as any
      );
      expect(connectedClients).toEqual(expect.arrayContaining(clientIds));
      expect(connectedClients.length).toBe(3);
    });

    it("should not include other users' clients", () => {
      const user1Id = "user-1";
      const user2Id = "user-2";
      const clientId1 = "client-1" as ClientId;
      const clientId2 = "client-2" as ClientId;

      const mockDevice: HomedDevice = {
        key: "test-device" as DeviceId,
        topic: "test/device",
        name: "Device",
        available: true,
        endpoints: [],
      };

      deviceRepository.syncClientDevices(user1Id as any, clientId1, [
        mockDevice,
      ]);
      deviceRepository.syncClientDevices(user2Id as any, clientId2, [
        mockDevice,
      ]);

      const user1Clients = deviceRepository.getConnectedClientIds(
        user1Id as any
      );
      const user2Clients = deviceRepository.getConnectedClientIds(
        user2Id as any
      );

      expect(user1Clients).toEqual([clientId1]);
      expect(user2Clients).toEqual([clientId2]);
      expect(user1Clients).not.toContain(clientId2);
      expect(user2Clients).not.toContain(clientId1);
    });

    it("should remove client when all devices are removed", () => {
      const clientId = "test-client" as ClientId;
      const mockDevice: HomedDevice = {
        key: "device-1" as DeviceId,
        topic: "device/1",
        name: "Test Device",
        available: true,
        endpoints: [],
      };

      deviceRepository.syncClientDevices(userId as any, clientId, [mockDevice]);
      deviceRepository.syncClientDevices(userId as any, clientId, []);

      const connectedClients = deviceRepository.getConnectedClientIds(
        userId as any
      );

      expect(connectedClients).toEqual([]);
    });

    it("should maintain correct set after device removals", () => {
      const client1Id = "client-1" as ClientId;
      const client2Id = "client-2" as ClientId;
      const mockDevice: HomedDevice = {
        key: "device-1" as DeviceId,
        topic: "device/1",
        name: "Device",
        available: true,
        endpoints: [],
      };

      deviceRepository.syncClientDevices(userId as any, client1Id, [
        mockDevice,
      ]);
      deviceRepository.syncClientDevices(userId as any, client2Id, [
        mockDevice,
      ]);
      deviceRepository.removeClientDevices(userId as any, client1Id);

      const connectedClients = deviceRepository.getConnectedClientIds(
        userId as any
      );

      expect(connectedClients).toEqual([client2Id]);
    });

    it("should handle multiple devices for same client", () => {
      const clientId = "test-client" as ClientId;
      const devices: HomedDevice[] = [
        {
          key: "device-1" as DeviceId,
          topic: "device/1",
          name: "Light 1",
          available: true,
          endpoints: [],
        },
        {
          key: "device-2" as DeviceId,
          topic: "device/2",
          name: "Light 2",
          available: true,
          endpoints: [],
        },
      ];

      deviceRepository.syncClientDevices(userId as any, clientId, devices);

      const connectedClients = deviceRepository.getConnectedClientIds(
        userId as any
      );
      expect(connectedClients).toEqual([clientId]);
      expect(connectedClients.length).toBe(1);
    });
  });
});
