import { ClientConnection } from "../tcp/client-connection";
import { ProtocolMessage } from "../tcp/protocol";
import { TCPServer } from "../tcp/server";

/**
 * Device service for querying and controlling devices via TCP clients
 *
 * NOTE: This implementation queries device states on-demand from TCP clients.
 * TODO: Future enhancement - implement caching layer for better performance.
 */
export class DeviceService {
  private tcpServer: TCPServer;

  constructor(tcpServer: TCPServer) {
    this.tcpServer = tcpServer;
  }

  /**
   * Get all devices for a user by aggregating from all their TCP clients
   * Devices are retrieved from multiple clients if present
   */
  async getAllDevices(userId: string): Promise<any[]> {
    const clients = this.tcpServer.getClientsByUser(userId);

    if (clients.length === 0) {
      return [];
    }

    // Query each client for their device list
    const devicePromises = clients.map((client: ClientConnection) =>
      this.queryClientDevices(client)
    );
    const deviceArrays = await Promise.all(devicePromises);

    // Merge devices from all clients
    // Use a Map to handle potential duplicate device IDs from multiple clients
    const deviceMap = new Map<string, any>();

    for (const devices of deviceArrays) {
      for (const device of devices) {
        const deviceId = device.id || device.key;
        if (deviceId && !deviceMap.has(deviceId)) {
          deviceMap.set(deviceId, device);
        }
      }
    }

    return Array.from(deviceMap.values());
  }

  /**
   * Query device states for specific device IDs
   */
  async queryDeviceStates(
    userId: string,
    deviceIds: string[]
  ): Promise<Map<string, any>> {
    const clients = this.tcpServer.getClientsByUser(userId);
    const stateMap = new Map<string, any>();

    if (clients.length === 0) {
      return stateMap;
    }

    // Query each client for device states
    for (const client of clients) {
      const clientStates = await this.queryClientStates(client, deviceIds);
      for (const [deviceId, state] of clientStates) {
        if (!stateMap.has(deviceId)) {
          stateMap.set(deviceId, state);
        }
      }
    }

    return stateMap;
  }

  /**
   * Execute command on a device
   *
   * NOTE: Commands are fire-and-forget for MVP.
   * TODO: Future enhancement - implement command result tracking and acknowledgment.
   */
  async executeCommand(
    userId: string,
    deviceId: string,
    command: { topic: string; message: any }
  ): Promise<{ success: boolean; error?: string }> {
    const clients = this.tcpServer.getClientsByUser(userId);

    if (clients.length === 0) {
      return { success: false, error: "No connected clients" };
    }

    // Send command to all clients (device might be on any client)
    const publishMessage: ProtocolMessage = {
      action: "publish",
      topic: command.topic,
      message: command.message,
    };

    try {
      // Broadcast to all user's clients
      this.tcpServer.broadcastToUser(userId, publishMessage);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Query devices from a single TCP client
   */
  private async queryClientDevices(client: ClientConnection): Promise<any[]> {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve([]);
      }, 5000); // 5 second timeout

      const devices: any[] = [];

      const messageHandler = (message: ProtocolMessage) => {
        // Parse device expose messages
        if (message.topic && message.topic.startsWith("expose/")) {
          // Topic format: expose/service
          const device = message.message;
          if (device && device.endpoints) {
            devices.push(device);
          }
        } else if (message.topic === "status/service") {
          // Initial device list from status message
          const deviceList = message.message?.devices;
          if (Array.isArray(deviceList)) {
            devices.push(...deviceList);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        client.removeListener("message", messageHandler);
      };

      client.on("message", messageHandler);

      // Request device expose data
      const subscribeMessage: ProtocolMessage = {
        action: "subscribe",
        topic: "expose/#",
      };

      try {
        client.sendMessage(subscribeMessage);

        // Also request status
        const statusMessage: ProtocolMessage = {
          action: "subscribe",
          topic: "status/#",
        };
        client.sendMessage(statusMessage);

        // Wait a bit for responses then resolve
        setTimeout(() => {
          cleanup();
          resolve(devices);
        }, 2000); // 2 seconds to collect device info
      } catch {
        cleanup();
        resolve([]);
      }
    });
  }

  /**
   * Query device states from a single TCP client
   */
  private async queryClientStates(
    client: ClientConnection,
    deviceIds: string[]
  ): Promise<Map<string, any>> {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(stateMap);
      }, 5000); // 5 second timeout

      const stateMap = new Map<string, any>();

      const messageHandler = (message: ProtocolMessage) => {
        // Parse device state messages
        if (message.topic && message.topic.startsWith("device/")) {
          // Topic format: device/{deviceId}/...
          const parts = message.topic.split("/");
          if (parts.length >= 2) {
            const deviceId = parts[1];
            if (deviceIds.includes(deviceId)) {
              stateMap.set(deviceId, message.message);
            }
          }
        } else if (message.topic && message.topic.startsWith("fd/")) {
          // From device messages: fd/{deviceId}/...
          const parts = message.topic.split("/");
          if (parts.length >= 2) {
            const deviceId = parts[1];
            if (deviceIds.includes(deviceId)) {
              stateMap.set(deviceId, message.message);
            }
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        client.removeListener("message", messageHandler);
      };

      client.on("message", messageHandler);

      // Request device state data
      const subscribeMessage: ProtocolMessage = {
        action: "subscribe",
        topic: "device/#",
      };

      try {
        client.sendMessage(subscribeMessage);

        // Also subscribe to from-device messages
        const fdMessage: ProtocolMessage = {
          action: "subscribe",
          topic: "fd/#",
        };
        client.sendMessage(fdMessage);

        // Wait for responses then resolve
        setTimeout(() => {
          cleanup();
          resolve(stateMap);
        }, 2000); // 2 seconds to collect state info
      } catch {
        cleanup();
        resolve(stateMap);
      }
    });
  }
}
