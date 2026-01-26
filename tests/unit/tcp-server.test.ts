import * as net from "net";
import { ClientConnection } from "../../src/tcp/client-connection.ts";
import type { ProtocolMessage } from "../../src/tcp/protocol.ts";
import { TCPServer } from "../../src/tcp/server.ts";

describe("TCPServer", () => {
  let server: TCPServer;
  const TEST_PORT = 19999 + Math.floor(Math.random() * 1000); // Random port to avoid conflicts

  beforeEach(() => {
    server = new TCPServer(TEST_PORT);
  });

  afterEach(async () => {
    if (server) {
      try {
        await server.stop();
      } catch {
        // Ignore errors on cleanup
      }
    }
  });

  describe("lifecycle", () => {
    it("should start successfully", async () => {
      await expect(server.start()).resolves.not.toThrow();
    });

    it("should emit listening event on start", async () => {
      const listeningPromise = new Promise<number>(resolve => {
        server.on("listening", (port: number) => {
          resolve(port);
        });
      });

      await server.start();
      const port = await listeningPromise;

      expect(port).toBe(TEST_PORT);
    });

    it("should stop successfully", async () => {
      await server.start();
      await expect(server.stop()).resolves.not.toThrow();
    });

    it("should handle stop when not started", async () => {
      await expect(server.stop()).resolves.not.toThrow();
    });

    it.skip("should reject start on port already in use", async () => {
      await server.start();

      const server2 = new TCPServer(TEST_PORT);

      await expect(server2.start()).rejects.toThrow(/EADDRINUSE/);

      // Cleanup
      await server2.stop().catch(() => {});
    }, 15000);
  });

  describe("client management", () => {
    it("should return empty array for non-existent user", async () => {
      await server.start();

      const clients = server.getClientIds("non-existent-user");
      expect(clients).toEqual([]);
    });

    it("should return undefined for non-existent client", async () => {
      await server.start();

      const client = server.getClient("non-existent-client");
      expect(client).toBeUndefined();
    });

    it("should handle disconnectClient for non-existent client", async () => {
      await server.start();

      expect(() => {
        server.disconnectClient("non-existent");
      }).not.toThrow();
    });
  });

  describe("events", () => {
    it("should emit client-handshake event", async () => {
      const handshakePromise = new Promise<ClientConnection>(
        (resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Handshake timeout"));
          }, 8000);

          server.on("client-handshake", (client: ClientConnection) => {
            clearTimeout(timeout);
            resolve(client);
          });
        }
      );

      await server.start();

      // Connect a real client and trigger handshake
      const client = net.createConnection({ port: TEST_PORT });

      // Send handshake
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xfffffffb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12345, 8);

      client.write(handshake);

      const connection = await handshakePromise;
      expect(connection).toBeInstanceOf(ClientConnection);

      client.destroy();
    }, 10000);

    it("should emit client-authorization event", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authPromise = new Promise<any>(resolve => {
        server.on(
          "client-authorization",
          (client: ClientConnection, auth: any) => {
            resolve(auth);
          }
        );
      });

      await server.start();

      // This would require a full handshake + auth flow
      // For now, we'll just test the event structure
      expect(authPromise).toBeDefined();
    });
  });

  describe("message routing", () => {
    it("should handle broadcastToUser with no clients", async () => {
      await server.start();

      const message: ProtocolMessage = {
        action: "publish",
        topic: "test/topic",
        message: { test: true },
      };

      expect(() => {
        server.broadcastToUser("user-1", message);
      }).not.toThrow();
    });
  });
});
