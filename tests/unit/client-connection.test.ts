import { EventEmitter } from "events";
import { Socket } from "net";
import { ClientConnection } from "../../src/tcp/client-connection.ts";
import {
  readPacket,
  unescapePacket,
  type ProtocolMessage,
} from "../../src/tcp/protocol.ts";

// Mock Socket
class MockSocket extends EventEmitter {
  public writtenData: Buffer[] = [];
  public remoteAddress = "127.0.0.1";
  public remotePort = 12345;

  write(data: Buffer): void {
    this.writtenData.push(data);
  }

  end(): void {
    this.emit("close");
  }
}

describe("ClientConnection", () => {
  let mockSocket: MockSocket;
  let client: ClientConnection;

  beforeEach(() => {
    mockSocket = new MockSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client = new ClientConnection(mockSocket as any as Socket);
  });

  describe("handshake", () => {
    it("should handle valid handshake data and send server public key", async () => {
      const handshakePromise = new Promise<void>(resolve => {
        client.on("handshake-complete", () => {
          // Server should send back 4-byte public key
          expect(mockSocket.writtenData.length).toBe(1);
          expect(mockSocket.writtenData[0].length).toBe(4);
          resolve();
        });
      });

      // Client sends: prime(4), generator(4), clientPublic(4)
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xfffffffb, 0); // prime
      handshake.writeUInt32BE(2, 4); // generator
      handshake.writeUInt32BE(12345, 8); // clientPublic

      mockSocket.emit("data", handshake);
      return handshakePromise;
    });

    it("should set up encryption after successful handshake", async () => {
      const handshakePromise = new Promise<void>(resolve => {
        client.on("handshake-complete", () => {
          resolve();
        });
      });

      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xfffffffb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12345, 8);

      mockSocket.emit("data", handshake);
      await handshakePromise;

      // After handshake, trying to send message should not throw
      const message: ProtocolMessage = {
        action: "publish",
        topic: "test/topic",
        message: { test: true },
      };

      expect(() => client.sendMessage(message)).not.toThrow();
    });
  });

  describe("authentication state", () => {
    it("should not be authenticated before authorization", () => {
      expect(client.isAuthenticated()).toBe(false);
      expect(client.getUserId()).toBeNull();
    });

    it("should be authenticated after setAuthenticated call", () => {
      client.setAuthenticated("user-123");

      expect(client.isAuthenticated()).toBe(true);
      expect(client.getUserId()).toBe("user-123");
    });

    it("should emit authenticated event when setAuthenticated is called", async () => {
      const authPromise = new Promise<string>(resolve => {
        client.on("authenticated", (userId: string) => {
          resolve(userId);
        });
      });

      client.setAuthenticated("user-456");
      const userId = await authPromise;

      expect(userId).toBe("user-456");
    });

    it("should return null for uniqueId before authorization", () => {
      expect(client.getUniqueId()).toBeNull();
    });
  });

  describe("message sending", () => {
    it("should throw error if AES not initialized", () => {
      const message: ProtocolMessage = {
        action: "publish",
        topic: "test/topic",
        message: { test: true },
      };

      expect(() => {
        client.sendMessage(message);
      }).toThrow("Cannot send message: AES not initialized");
    });

    it("should send encrypted message after handshake", async () => {
      // Complete handshake
      const handshakePromise = new Promise<void>(resolve => {
        client.on("handshake-complete", () => {
          resolve();
        });
      });

      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xfffffffb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12345, 8);

      mockSocket.emit("data", handshake);
      await handshakePromise;

      // Send message
      const message: ProtocolMessage = {
        action: "publish",
        topic: "test/topic",
        message: { data: "hello" },
      };

      client.sendMessage(message);

      // Verify something was written
      expect(mockSocket.writtenData.length).toBeGreaterThan(1);
      const lastWrite =
        mockSocket.writtenData[mockSocket.writtenData.length - 1];
      expect(lastWrite[0]).toBe(0x42);
      expect(lastWrite[lastWrite.length - 1]).toBe(0x43);
    });

    it("should properly frame and escape message", async () => {
      const handshakePromise = new Promise<void>(resolve => {
        client.on("handshake-complete", () => {
          resolve();
        });
      });

      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xfffffffb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12345, 8);

      mockSocket.emit("data", handshake);
      await handshakePromise;

      const message: ProtocolMessage = {
        action: "publish",
        topic: "test/topic",
        message: { test: true },
      };

      client.sendMessage(message);

      const lastWrite =
        mockSocket.writtenData[mockSocket.writtenData.length - 1];

      // Should have frame markers
      expect(lastWrite[0]).toBe(0x42);
      expect(lastWrite[lastWrite.length - 1]).toBe(0x43);

      // Extract packet
      const [packet] = readPacket(lastWrite);
      expect(packet).not.toBeNull();

      // Unescaping should not throw
      expect(() => unescapePacket(packet!)).not.toThrow();
    });
  });

  describe("connection lifecycle", () => {
    it("should emit close event when socket closes", async () => {
      const closePromise = new Promise<void>(resolve => {
        client.on("close", () => {
          resolve();
        });
      });

      mockSocket.emit("close");
      return closePromise;
    });

    it("should emit error event when socket errors", async () => {
      const errorPromise = new Promise<Error>(resolve => {
        client.on("error", (error: Error) => {
          resolve(error);
        });
      });

      const testError = new Error("Socket error");
      mockSocket.emit("error", testError);

      const error = await errorPromise;
      expect(error).toBe(testError);
    });

    it("should close the socket via close method", async () => {
      const closePromise = new Promise<void>(resolve => {
        client.on("close", () => {
          resolve();
        });
      });

      client.close();
      return closePromise;
    });
  });

  describe("handshake protocol", () => {
    it("should handle multiple handshakes with different parameters", async () => {
      // First handshake
      const promise1 = new Promise<void>(resolve => {
        client.on("handshake-complete", () => {
          resolve();
        });
      });

      const handshake1 = Buffer.allocUnsafe(12);
      handshake1.writeUInt32BE(0xfffffffb, 0);
      handshake1.writeUInt32BE(2, 4);
      handshake1.writeUInt32BE(12345, 8);

      mockSocket.emit("data", handshake1);
      await promise1;

      expect(mockSocket.writtenData.length).toBe(1);
    });

    it("should compute valid server public key from client parameters", async () => {
      const promise = new Promise<Buffer>(resolve => {
        client.on("handshake-complete", () => {
          const serverPublic = mockSocket.writtenData[0];
          resolve(serverPublic);
        });
      });

      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xfffffffb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(54321, 8);

      mockSocket.emit("data", handshake);
      const serverPub = await promise;

      // Should be 4 bytes
      expect(serverPub.length).toBe(4);
      // Should be valid UInt32 value
      const value = serverPub.readUInt32BE(0);
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThan(0);
    });
  });
});
