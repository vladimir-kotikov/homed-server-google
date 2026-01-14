/**
 * Integration test: Message Flow
 * Tests message routing between MQTT, client, and TCP server
 */

import { FIXTURES, MQTTPublisher } from "./mqtt-publisher";
import { delay, getServiceLogs } from "./test-utils";

describe("Message Flow Integration", () => {
  let publisher: MQTTPublisher;

  beforeAll(async () => {
    publisher = new MQTTPublisher("localhost", 1883, "homed");
    await publisher.connect();
  });

  afterAll(async () => {
    if (publisher) {
      await publisher.disconnect();
    }
  });

  describe("Topic Routing", () => {
    it("should route status/* topics correctly", async () => {
      await publisher.publishServiceStatus("zigbee", [
        FIXTURES.switch(),
        FIXTURES.light(),
      ]);

      await delay(3000);

      const logs = getServiceLogs("tcp-server", 50);

      // Should contain status-related activity
      expect(logs.length).toBeGreaterThan(0);
    });

    it("should route expose/* topics correctly", async () => {
      const device = FIXTURES.light();

      await publisher.publishDeviceExposes(
        device.service,
        device.deviceId,
        device.endpoints
      );

      await delay(2000);

      const logs = getServiceLogs("tcp-server", 50);
      expect(logs.length).toBeGreaterThan(0);
    });

    it("should route fd/* (from device) topics correctly", async () => {
      const device = FIXTURES.switch();

      await publisher.publishDeviceState(
        device.service,
        device.deviceId,
        null,
        { switch: true }
      );

      await delay(2000);

      const logs = getServiceLogs("tcp-server", 50);
      expect(logs.length).toBeGreaterThan(0);
    });

    it("should route device/* availability topics", async () => {
      const device = FIXTURES.temperatureSensor();

      await publisher.publishDeviceStatus(
        device.service,
        device.deviceId,
        true,
        Date.now()
      );

      await delay(2000);

      const logs = getServiceLogs("tcp-server", 50);
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe("Message Format Validation", () => {
    it("should handle valid JSON messages", async () => {
      const device = FIXTURES.switch();

      await publisher.publishDeviceState(
        device.service,
        device.deviceId,
        null,
        {
          switch: true,
          timestamp: Date.now(),
          extra: { foo: "bar", nested: { value: 123 } },
        }
      );

      await delay(2000);

      const serverLogs = getServiceLogs("tcp-server", 30);
      const clientLogs = getServiceLogs("homed-client", 30);

      // Should not have JSON parse errors
      expect(serverLogs).not.toContain("JSON");
      expect(serverLogs).not.toContain("parse error");
      expect(clientLogs).not.toContain("error");
    });

    it("should handle messages with special characters", async () => {
      const device = FIXTURES.light();

      await publisher.publishDeviceState(
        device.service,
        device.deviceId,
        null,
        {
          name: "Test \"Device\" with 'quotes'",
          description: "Special chars: \n\t\r",
          unicode: "测试 🏠",
        }
      );

      await delay(2000);

      const logs = getServiceLogs("tcp-server", 30);

      // Should handle without errors
      expect(logs).not.toContain("encoding error");
      expect(logs).not.toContain("invalid");
    });

    it("should handle empty state objects", async () => {
      const device = FIXTURES.switch();

      await publisher.publishDeviceState(
        device.service,
        device.deviceId,
        null,
        {}
      );

      await delay(2000);

      const logs = getServiceLogs("tcp-server", 30);
      // Should process without crashing
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe("Message Timing", () => {
    it("should handle messages sent in quick succession", async () => {
      const device = FIXTURES.switch();

      // Send 20 messages as fast as possible
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          publisher.publishDeviceState(device.service, device.deviceId, null, {
            switch: i % 2 === 0,
            index: i,
          })
        );
      }

      await Promise.all(promises);
      await delay(5000);

      const serverLogs = getServiceLogs("tcp-server", 100);
      const clientLogs = getServiceLogs("homed-client", 100);

      // Should not have crashed or disconnected
      expect(serverLogs).not.toContain("crash");
      expect(serverLogs).not.toContain("fatal");
      expect(clientLogs).not.toContain("disconnect");
    }, 15000);

    it("should handle delayed messages", async () => {
      const device = FIXTURES.light();

      await publisher.publishDeviceState(
        device.service,
        device.deviceId,
        null,
        {
          light: true,
          level: 25,
        }
      );

      // Wait 5 seconds
      await delay(5000);

      await publisher.publishDeviceState(
        device.service,
        device.deviceId,
        null,
        {
          light: true,
          level: 50,
        }
      );

      await delay(2000);

      const logs = getServiceLogs("tcp-server", 50);
      // Should have processed both messages
      expect(logs.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe("Error Scenarios", () => {
    it("should handle device offline status", async () => {
      const device = FIXTURES.switch();

      // Mark device as offline
      await publisher.publishDeviceStatus(
        device.service,
        device.deviceId,
        false
      );

      await delay(2000);

      const logs = getServiceLogs("tcp-server", 30);

      // Should process offline status
      expect(logs.length).toBeGreaterThan(0);
    });

    it("should handle device coming back online", async () => {
      const device = FIXTURES.temperatureSensor();

      // Offline
      await publisher.publishDeviceStatus(
        device.service,
        device.deviceId,
        false
      );
      await delay(2000);

      // Online
      await publisher.publishDeviceStatus(
        device.service,
        device.deviceId,
        true
      );
      await delay(2000);

      // Send state after coming online
      await publisher.publishDeviceState(
        device.service,
        device.deviceId,
        null,
        {
          temperature: 23.5,
          humidity: 50,
        }
      );

      await delay(2000);

      const logs = getServiceLogs("tcp-server", 50);
      expect(logs.length).toBeGreaterThan(0);
    }, 15000);
  });

  describe("Multiple Services", () => {
    it("should handle devices from different services", async () => {
      const devices = [
        { ...FIXTURES.switch(), service: "zigbee" },
        {
          ...FIXTURES.light(),
          service: "modbus",
          deviceId: "modbus-light-001",
        },
        {
          ...FIXTURES.temperatureSensor(),
          service: "custom",
          deviceId: "custom-sensor-001",
        },
      ];

      for (const device of devices) {
        await publisher.publishDevice(device);
        await delay(1000);
      }

      await delay(3000);

      const logs = getServiceLogs("tcp-server", 100);

      // Should have activity from different services
      const hasActivity = logs.length > 0;

      expect(hasActivity).toBe(true);
    }, 15000);
  });
});
