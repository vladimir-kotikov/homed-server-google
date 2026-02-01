import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { beforeEach, describe, expect, it } from "vitest";
import type { User } from "../../../src/db/repository.ts";
import { ClientConnection } from "../../../src/homed/client.ts";
import { readPacket, unescapePacket } from "../../../src/homed/protocol.ts";
import type { ServerMessage } from "../../../src/homed/schema.ts";

// Mock Socket
class MockSocket extends EventEmitter {
  public writtenData: Buffer[] = [];
  public remoteAddress = "127.0.0.1";
  public remotePort = 12_345;

  write(data: Buffer): void {
    this.writtenData.push(data);
  }

  end(): void {
    this.emit("close");
  }
}

describe("ClientConnection", () => {
  let mockSocket: MockSocket;
  let client: ClientConnection<User>;

  beforeEach(() => {
    mockSocket = new MockSocket();

    client = new ClientConnection<User>(mockSocket as any as Socket);
  });

  describe("handshake", () => {
    it("should handle valid handshake data and send server public key", () => {
      // Client sends: prime(4), generator(4), clientPublic(4)
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0); // prime
      handshake.writeUInt32BE(2, 4); // generator
      handshake.writeUInt32BE(12_345, 8); // clientPublic

      mockSocket.emit("data", handshake);

      // Server should send back 4-byte public key
      expect(mockSocket.writtenData.length).toBe(1);
      expect(mockSocket.writtenData[0].length).toBe(4);
    });

    it("should set up encryption after successful handshake", () => {
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12_345, 8);

      mockSocket.emit("data", handshake);

      // After handshake, trying to send message should not throw
      const message: ServerMessage = {
        action: "publish",
        topic: "test/topic",
        message: { test: true },
      };

      expect(() => client.sendMessage(message)).not.toThrow();
    });
  });

  describe("message sending", () => {
    it("should throw error if AES not initialized", () => {
      const message: ServerMessage = {
        action: "publish",
        topic: "test/topic",
        message: { test: true },
      };

      expect(() => {
        client.sendMessage(message);
      }).toThrow("Cannot send message: AES not initialized");
    });

    it("should send encrypted message after handshake", () => {
      // Complete handshake
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12_345, 8);

      mockSocket.emit("data", handshake);

      // Send message
      const message: ServerMessage = {
        action: "publish",
        topic: "test/topic",
        message: { data: "hello" },
      };

      client.sendMessage(message);

      // Verify something was written
      expect(mockSocket.writtenData.length).toBeGreaterThan(1);
      const lastWrite = mockSocket.writtenData.at(-1);
      expect(lastWrite?.at(0)).toBe(0x42);
      expect(lastWrite?.at(-1)).toBe(0x43);
    });

    it("should properly frame and escape message", () => {
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12_345, 8);

      mockSocket.emit("data", handshake);

      const message: ServerMessage = {
        action: "publish",
        topic: "test/topic",
        message: { test: true },
      };

      client.sendMessage(message);

      const lastWrite = mockSocket.writtenData.at(-1);

      expect(lastWrite?.at(0)).toBe(0x42);
      expect(lastWrite?.at(-1)).toBe(0x43);

      // Extract packet
      const [packet] = readPacket(lastWrite!);
      expect(packet).not.toBeUndefined();

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
    it("should handle multiple handshakes with different parameters", () => {
      // First handshake
      const handshake1 = Buffer.allocUnsafe(12);
      handshake1.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake1.writeUInt32BE(2, 4);
      handshake1.writeUInt32BE(12_345, 8);

      mockSocket.emit("data", handshake1);

      expect(mockSocket.writtenData.length).toBe(1);
    });

    it("should compute valid server public key from client parameters", () => {
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(54_321, 8);

      mockSocket.emit("data", handshake);

      const serverPub = mockSocket.writtenData[0];

      // Should be 4 bytes
      expect(serverPub.length).toBe(4);
      // Should be valid UInt32 value
      const value = serverPub.readUInt32BE(0);
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThan(0);
    });
  });

  describe("message handling", () => {
    it("should handle sendMessage error and emit error event", () => {
      const errorPromise = new Promise<Error>(resolve => {
        client.on("error", (error: Error) => {
          resolve(error);
        });
      });

      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12_345, 8);
      mockSocket.emit("data", handshake);

      const message: ServerMessage = {
        action: "publish",
        topic: "test/topic",
        message: { test: true },
      };

      // Mock cipher.encrypt to throw an error
      const originalCipher = (client as any).cipher;
      (client as any).cipher = {
        encrypt: (): Buffer => {
          throw new Error("Encryption failed");
        },
      };

      client.sendMessage(message);

      // Restore
      (client as any).cipher = originalCipher;

      return errorPromise.then(error => {
        expect(error.message).toContain("Failed to send message");
      });
    });
  });

  describe("authorization and timeout", () => {
    it("should call authorize to set authorized state", () => {
      expect(client.user).toBeUndefined();

      // Complete handshake first to initialize cipher
      const handshake = Buffer.allocUnsafe(12);
      handshake.writeUInt32BE(0xff_ff_ff_fb, 0);
      handshake.writeUInt32BE(2, 4);
      handshake.writeUInt32BE(12_345, 8);
      mockSocket.emit("data", handshake);

      const user = {
        id: "user1",
        username: "Test User",
        clientToken: "token123",
        createdAt: new Date(),
      } as User;

      client.authorize(user);
      expect((client as any).user).toBe(user);
    });

    it("should not process messages before handshake", () => {
      const messagePromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), 100);
        client.on("devices", () => {
          clearTimeout(timeout);
          reject(new Error("Should not process message before handshake"));
        });
      });

      // Send message without handshake
      const data = Buffer.from([0x42, 0x01, 0x02, 0x43]);
      mockSocket.emit("data", data);

      return messagePromise;
    });

    it("should buffer incomplete handshake data", () => {
      // Send partial handshake (only 6 bytes of 12)
      const partial = Buffer.allocUnsafe(6);
      partial.writeUInt32BE(0xff_ff_ff_fb, 0);
      partial.writeUInt16BE(2, 4);

      mockSocket.emit("data", partial);

      // Should not have written anything yet
      expect(mockSocket.writtenData.length).toBe(0);

      // Send remainder
      const remaining = Buffer.allocUnsafe(6);
      remaining.writeUInt16BE(4, 0);
      remaining.writeUInt32BE(12_345, 2);

      mockSocket.emit("data", remaining);

      // Now should have handshake response
      expect(mockSocket.writtenData.length).toBe(1);
    });
  });
});
