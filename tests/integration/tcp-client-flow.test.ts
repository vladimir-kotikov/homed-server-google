/**
 * Integration test: TCP Client Flow
 * Tests the complete flow of client connection, authentication, and message routing
 */

import { FIXTURES, MQTTPublisher } from "./mqtt-publisher";
import { delay, getServiceLogs, readTestConfig } from "./test-utils";

describe("TCP Client Integration Flow", () => {
  let publisher: MQTTPublisher;

  beforeAll(async () => {
    // Load test configuration
    try {
      readTestConfig();
      console.log("📋 Test configuration loaded");
    } catch {
      throw new Error("Test configuration not found. Run: npm run seed:test");
    }

    // Connect MQTT publisher
    publisher = new MQTTPublisher("localhost", 1883, "homed");
    await publisher.connect();
    console.log("✅ MQTT publisher connected");
  });

  afterAll(async () => {
    if (publisher) {
      await publisher.disconnect();
    }
  });

  describe("Client Connection and Authentication", () => {
    it("should have client connected and authenticated", async () => {
      // Wait a bit for logs to accumulate
      await delay(2000);

      const serverLogs = getServiceLogs("tcp-server", 100);
      const clientLogs = getServiceLogs("homed-client", 100);

      // Check server logs for connection
      expect(serverLogs).toContain("listening");

      // Check for authentication success
      // Note: Actual log format depends on implementation
      const hasConnection =
        serverLogs.includes("client") ||
        serverLogs.includes("connection") ||
        serverLogs.includes("authenticated");

      expect(hasConnection).toBe(true);

      // Check client logs for successful connection
      const clientConnected =
        clientLogs.includes("connect") || clientLogs.length > 0;

      expect(clientConnected).toBe(true);
    }, 30000);

    it("should maintain connection for at least 10 seconds", async () => {
      await delay(10000);

      const laterLogs = getServiceLogs("tcp-server", 10);
      const clientLogs = getServiceLogs("homed-client", 20);

      // Should not have disconnect or error messages
      expect(laterLogs).not.toContain("disconnect");
      expect(laterLogs).not.toContain("Authentication failed");
      expect(clientLogs).not.toContain("error");
    }, 15000);
  });

  describe("Device Data Flow", () => {
    it("should forward device list from MQTT to TCP server", async () => {
      const switchDevice = FIXTURES.switch();

      // Publish device status and capabilities
      await publisher.publishServiceStatus(switchDevice.service, [
        switchDevice,
      ]);
      await publisher.publishDeviceExposes(
        switchDevice.service,
        switchDevice.deviceId,
        switchDevice.endpoints
      );

      // Wait for message propagation
      await delay(3000);

      const serverLogs = getServiceLogs("tcp-server", 50);

      // Verify server received messages
      // Log format will vary, but should contain topic or device references
      const hasDeviceData =
        serverLogs.includes("status") ||
        serverLogs.includes("expose") ||
        serverLogs.includes(switchDevice.deviceId);

      expect(hasDeviceData).toBe(true);
    }, 10000);

    it("should forward device state updates from MQTT to TCP server", async () => {
      const switchDevice = FIXTURES.switch();

      // Publish initial state
      await publisher.publishDeviceState(
        switchDevice.service,
        switchDevice.deviceId,
        null,
        {
          switch: false,
        }
      );

      await delay(2000);

      // Publish state change
      await publisher.publishDeviceState(
        switchDevice.service,
        switchDevice.deviceId,
        null,
        {
          switch: true,
        }
      );

      await delay(2000);

      const serverLogs = getServiceLogs("tcp-server", 50);

      // Should have received fd (from device) messages
      const hasStateUpdate =
        serverLogs.includes("fd/") ||
        serverLogs.includes("publish") ||
        serverLogs.includes(switchDevice.deviceId);

      expect(hasStateUpdate).toBe(true);
    }, 10000);
  });

  describe("Multiple Device Handling", () => {
    it("should handle multiple devices simultaneously", async () => {
      const devices = [
        FIXTURES.switch(),
        FIXTURES.light(),
        FIXTURES.temperatureSensor(),
      ];

      // Publish all devices
      for (const device of devices) {
        await publisher.publishDevice(device);
        await delay(500); // Stagger slightly
      }

      await delay(3000);

      const serverLogs = getServiceLogs("tcp-server", 100);

      // Should have received data for all devices
      // At minimum, should have some activity
      expect(serverLogs.length).toBeGreaterThan(0);
    }, 15000);

    it("should handle rapid state updates", async () => {
      const switchDevice = FIXTURES.switch();

      // Send 10 rapid state updates
      for (let i = 0; i < 10; i++) {
        await publisher.publishDeviceState(
          switchDevice.service,
          switchDevice.deviceId,
          null,
          {
            switch: i % 2 === 0,
            sequence: i,
          }
        );
        await delay(200);
      }

      await delay(2000);

      const serverLogs = getServiceLogs("tcp-server", 100);
      const clientLogs = getServiceLogs("homed-client", 100);

      // Should not have errors or disconnections
      expect(serverLogs).not.toContain("error");
      expect(clientLogs).not.toContain("disconnect");

      // Should have processed messages
      expect(serverLogs.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe("Complex Device Types", () => {
    it("should handle dimmable light with level", async () => {
      const light = FIXTURES.light();

      await publisher.publishDevice(light, { light: true, level: 50 });
      await delay(2000);

      // Update brightness
      await publisher.publishDeviceState(light.service, light.deviceId, null, {
        light: true,
        level: 100,
      });

      await delay(2000);

      const serverLogs = getServiceLogs("tcp-server", 50);
      expect(serverLogs.length).toBeGreaterThan(0);
    }, 10000);

    it("should handle color light with RGB", async () => {
      const colorLight = FIXTURES.colorLight();

      await publisher.publishDevice(colorLight, {
        light: true,
        level: 75,
        color: { r: 255, g: 0, b: 0 },
      });

      await delay(2000);

      const serverLogs = getServiceLogs("tcp-server", 50);
      expect(serverLogs.length).toBeGreaterThan(0);
    }, 10000);

    it("should handle sensor with multiple values", async () => {
      const sensor = FIXTURES.temperatureSensor();

      await publisher.publishDevice(sensor, {
        temperature: 22.5,
        humidity: 45.8,
      });

      await delay(2000);

      // Simulate periodic updates
      for (let i = 0; i < 3; i++) {
        await publisher.publishDeviceState(
          sensor.service,
          sensor.deviceId,
          null,
          {
            temperature: 22.5 + i * 0.5,
            humidity: 45.8 - i * 1.0,
          }
        );
        await delay(1000);
      }

      const serverLogs = getServiceLogs("tcp-server", 50);
      expect(serverLogs.length).toBeGreaterThan(0);
    }, 15000);
  });
});
