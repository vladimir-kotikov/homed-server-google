/**
 * MQTT test publisher utility
 * Publishes device data to Homed MQTT topics for integration testing
 */

import { connect, MqttClient } from "mqtt";

export interface DeviceFixture {
  service: string;
  deviceId: string;
  name: string;
  description: string;
  available: boolean;
  endpoints: EndpointFixture[];
}

export interface EndpointFixture {
  id: number;
  type: string;
  exposes: string[];
  options?: Record<string, any>;
}

export interface DeviceState {
  [key: string]: any;
}

export class MQTTPublisher {
  private client: MqttClient | null = null;
  private prefix: string;

  constructor(
    private host: string,
    private port: number,
    prefix: string = "homed"
  ) {
    this.prefix = prefix;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = connect(`mqtt://${this.host}:${this.port}`);

      this.client.on("connect", () => {
        console.log("✅ Connected to MQTT broker");
        resolve();
      });

      this.client.on("error", error => {
        console.error("❌ MQTT connection error:", error);
        reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.endAsync();
      this.client = null;
    }
  }

  /**
   * Publish service status (device list)
   */
  async publishServiceStatus(
    service: string,
    devices: DeviceFixture[]
  ): Promise<void> {
    const topic = `${this.prefix}/status/${service}`;
    const payload = {
      devices: devices.map(d => ({
        key: d.deviceId,
        name: d.name,
        description: d.description,
      })),
      version: "1.0.0",
      timestamp: Date.now(),
    };

    await this.publish(topic, payload, true);
  }

  /**
   * Publish device availability status
   */
  async publishDeviceStatus(
    service: string,
    deviceId: string,
    available: boolean,
    lastSeen?: number
  ): Promise<void> {
    const topic = `${this.prefix}/device/${service}/${deviceId}`;
    const payload: any = { status: available ? "online" : "offline" };

    if (lastSeen) {
      payload.lastSeen = lastSeen;
    }

    await this.publish(topic, payload, true);
  }

  /**
   * Publish device capabilities (exposes)
   */
  async publishDeviceExposes(
    service: string,
    deviceId: string,
    endpoints: EndpointFixture[]
  ): Promise<void> {
    const topic = `${this.prefix}/expose/${service}/${deviceId}`;
    const payload = { endpoints };

    await this.publish(topic, payload, true);
  }

  /**
   * Publish device state (from device - fd)
   */
  async publishDeviceState(
    service: string,
    deviceId: string,
    endpointId: number | null,
    state: DeviceState
  ): Promise<void> {
    const endpointSuffix = endpointId !== null ? `/${endpointId}` : "";
    const topic = `${this.prefix}/fd/${service}/${deviceId}${endpointSuffix}`;

    await this.publish(topic, state, false);
  }

  /**
   * Publish command to device (to device - td)
   */
  async publishDeviceCommand(
    service: string,
    deviceId: string,
    endpointId: number | null,
    command: Record<string, any>
  ): Promise<void> {
    const endpointSuffix = endpointId !== null ? `/${endpointId}` : "";
    const topic = `${this.prefix}/td/${service}/${deviceId}${endpointSuffix}`;

    await this.publish(topic, command, false);
  }

  /**
   * Publish complete device (convenience method)
   */
  async publishDevice(
    device: DeviceFixture,
    initialState?: DeviceState
  ): Promise<void> {
    // Publish device status
    await this.publishDeviceStatus(
      device.service,
      device.deviceId,
      device.available
    );

    // Publish device capabilities
    await this.publishDeviceExposes(
      device.service,
      device.deviceId,
      device.endpoints
    );

    // Publish initial state if provided
    if (initialState) {
      await this.publishDeviceState(
        device.service,
        device.deviceId,
        null,
        initialState
      );
    }
  }

  private async publish(
    topic: string,
    payload: any,
    retain: boolean
  ): Promise<void> {
    if (!this.client) {
      throw new Error("MQTT client not connected");
    }

    const message = JSON.stringify(payload);
    console.log(`📤 Publishing to ${topic} (retain: ${retain})`);

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, message, { retain, qos: 1 }, error => {
        if (error) {
          console.error(`❌ Failed to publish to ${topic}:`, error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

// Device fixtures for common device types
export const FIXTURES = {
  switch: (): DeviceFixture => ({
    service: "zigbee",
    deviceId: "test-switch-001",
    name: "Test Switch",
    description: "Integration test switch device",
    available: true,
    endpoints: [
      {
        id: 1,
        type: "switch",
        exposes: ["switch"],
        options: {},
      },
    ],
  }),

  light: (): DeviceFixture => ({
    service: "zigbee",
    deviceId: "test-light-001",
    name: "Test Light",
    description: "Integration test dimmable light",
    available: true,
    endpoints: [
      {
        id: 1,
        type: "light",
        exposes: ["light", "level"],
        options: {
          dimmable: true,
        },
      },
    ],
  }),

  colorLight: (): DeviceFixture => ({
    service: "zigbee",
    deviceId: "test-color-light-001",
    name: "Test Color Light",
    description: "Integration test RGB light",
    available: true,
    endpoints: [
      {
        id: 1,
        type: "light",
        exposes: ["light", "level", "color", "colorTemperature"],
        options: {
          dimmable: true,
          color: true,
        },
      },
    ],
  }),

  temperatureSensor: (): DeviceFixture => ({
    service: "zigbee",
    deviceId: "test-temp-sensor-001",
    name: "Test Temperature Sensor",
    description: "Integration test temperature sensor",
    available: true,
    endpoints: [
      {
        id: 1,
        type: "sensor",
        exposes: ["temperature", "humidity"],
        options: {},
      },
    ],
  }),

  contactSensor: (): DeviceFixture => ({
    service: "zigbee",
    deviceId: "test-contact-001",
    name: "Test Contact Sensor",
    description: "Integration test contact sensor",
    available: true,
    endpoints: [
      {
        id: 1,
        type: "sensor",
        exposes: ["contact"],
        options: {},
      },
    ],
  }),
};
