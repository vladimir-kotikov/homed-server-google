import { EventEmitter } from "events";
import { Server as NetServer, Socket, createServer } from "net";
import { ClientConnection } from "./client-connection.ts";
import type { ProtocolMessage } from "./protocol.ts";

/**
 * TCP server for accepting Homed client connections
 *
 * Device caching: Stores MQTT expose messages for each user so SYNC requests
 * can return device list without requiring subscribe/query roundtrips
 */
export class TCPServer extends EventEmitter {
  private port: number;
  private server: NetServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private userClients: Map<string, Set<string>> = new Map();
  // Cache: userId -> deviceId -> device object
  private userDevices: Map<string, Map<string, any>> = new Map();

  constructor(port: number) {
    super();
    this.port = port;
  }

  /**
   * Start the TCP server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        this.handleConnection(socket);
      });

      this.server.on("error", (error: Error) => {
        this.emit("error", error);
        reject(error);
      });

      this.server.listen(this.port, () => {
        this.emit("listening", this.port);
        resolve();
      });
    });
  }

  /**
   * Stop the TCP server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      // Close all client connections
      for (const client of this.clients.values()) {
        client.close();
      }
      this.clients.clear();
      this.userClients.clear();

      this.server.close((error?: Error) => {
        if (error) {
          reject(error);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Handle a new client connection
   */
  private handleConnection(socket: Socket): void {
    const client = new ClientConnection(socket);

    client.on("handshake-complete", () => {
      this.emit("client-handshake", client);
    });

    client.on("authorization", (auth: { uniqueId: string; token: string }) => {
      this.emit("client-authorization", client, auth);
    });

    client.on("authenticated", (userId: string) => {
      // Store client by uniqueId
      const uniqueId = client.getUniqueId();
      if (uniqueId) {
        this.clients.set(uniqueId, client);

        // Map client to user
        if (!this.userClients.has(userId)) {
          this.userClients.set(userId, new Set());
        }

        this.userClients.get(userId)!.add(uniqueId);

        // Send initial subscription requests to client for common topics
        // This ensures the client will forward MQTT messages to us
        // Use setImmediate to ensure client is fully ready to receive encrypted messages
        setImmediate(() => {
          const defaultTopics = ["expose/#", "device/#", "fd/#", "status/#"];
          for (const topic of defaultTopics) {
            console.log(
              `Sending subscribe request to client for topic: ${topic}`
            );
            try {
              client.sendMessage({
                action: "subscribe",
                topic: topic,
              });
            } catch (error) {
              console.error(`Failed to send subscribe for ${topic}:`, error);
            }
          }
        });

        this.emit("client-authenticated", client, userId);
      }
    });

    client.on("message", (message: ProtocolMessage) => {
      this.emit("client-message", client, message);
    });

    client.on("error", (error: Error) => {
      this.emit("client-error", client, error);
    });

    client.on("close", () => {
      // Remove client from maps
      const uniqueId = client.getUniqueId();
      const userId = client.getUserId();

      if (uniqueId) {
        this.clients.delete(uniqueId);
      }

      if (userId && uniqueId) {
        const userClientSet = this.userClients.get(userId);
        if (userClientSet) {
          userClientSet.delete(uniqueId);
          if (userClientSet.size === 0) {
            this.userClients.delete(userId);
            // Clear device cache when last client for user disconnects
            this.clearUserDeviceCache(userId);
          }
        }
      }

      this.emit("client-disconnected", client);
    });
  }

  /**
   * Get all clients for a specific user
   */
  getClientsByUser(userId: string): ClientConnection[] {
    const clientIds = this.userClients.get(userId);
    if (!clientIds) {
      return [];
    }

    const clients: ClientConnection[] = [];
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (client) {
        clients.push(client);
      }
    }

    return clients;
  }

  /**
   * Get a client by unique ID
   */
  getClient(uniqueId: string): ClientConnection | undefined {
    return this.clients.get(uniqueId);
  }

  /**
   * Disconnect a client by unique ID
   */
  disconnectClient(uniqueId: string): void {
    const client = this.clients.get(uniqueId);
    if (client) {
      client.close();
    }
  }

  /**
   * Broadcast message to all clients of a user
   */
  broadcastToUser(userId: string, message: ProtocolMessage): void {
    const clients = this.getClientsByUser(userId);
    for (const client of clients) {
      client.sendMessage(message);
    }
  }

  /**
   * Get total number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get all connected client unique IDs
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Store device information from MQTT expose message
   * Called when server receives expose messages from TCP client
   */
  cacheDevice(userId: string, deviceId: string, device: any): void {
    if (!this.userDevices.has(userId)) {
      this.userDevices.set(userId, new Map());
    }

    const userDeviceMap = this.userDevices.get(userId)!;
    userDeviceMap.set(deviceId, device);
  }

  /**
   * Get all cached devices for a user
   * Used by SYNC endpoint to return device list
   */
  getCachedDevices(userId: string): any[] {
    const userDeviceMap = this.userDevices.get(userId);
    if (!userDeviceMap) {
      return [];
    }

    return Array.from(userDeviceMap.values());
  }

  /**
   * Clear device cache for a user (e.g., when client disconnects)
   */
  clearUserDeviceCache(userId: string): void {
    this.userDevices.delete(userId);
  }
}
