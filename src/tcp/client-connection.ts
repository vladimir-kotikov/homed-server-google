import { EventEmitter } from "events";
import { Socket } from "net";
import { AES128CBC } from "./crypto.ts";
import {
  escapePacket,
  readPacket,
  unescapePacket,
  type ProtocolMessage,
} from "./protocol.ts";

/**
 * Represents a single TCP client connection
 */
export class ClientConnection extends EventEmitter {
  private socket: Socket;
  private aes: AES128CBC | null = null;
  private authenticated = false;
  private userId: string | null = null;
  private uniqueId: string | null = null;
  private handshakeComplete = false;

  private buf: Buffer = Buffer.alloc(0);

  constructor(socket: Socket) {
    super();
    this.socket = socket;
    this.setupSocketHandlers();
  }

  /**
   * Set up socket event handlers
   */
  private setupSocketHandlers(): void {
    this.socket.on("data", (data: Buffer) => {
      this.receiveData(data);
    });

    this.socket.on("error", (error: Error) => {
      this.emit("error", error);
    });

    this.socket.on("close", () => {
      this.emit("close");
    });
  }

  /**
   * Handle incoming data
   */
  private receiveData(data: Buffer): void {
    this.buf = Buffer.concat([this.buf, data]);
    if (!this.handshakeComplete) {
      this.tryHandleHandshake();
    } else {
      // All post-handshake data MUST be framed and encrypted
      // There is no plaintext JSON fallback - this is protocol-critical
      this.handlePackets();
    }
  }

  /**
   * Handle DH handshake data (12 bytes)
   * Protocol: client sends [prime(4), generator(4), publicKey(4)] in big-endian
   */
  private tryHandleHandshake(): void {
    if (this.buf.length < 12) {
      return;
    }

    try {
      const handshake = this.buf.subarray(0, 12);
      const [cipher, publicKey] = AES128CBC.fromHandshake(handshake);

      this.aes = cipher;
      this.buf = this.buf.subarray(12); // Remove handshake data from buffer
      this.socket.write(publicKey);
      this.handshakeComplete = true;
      this.emit("handshake-complete");
    } catch (error) {
      this.emit("error", new Error(`Handshake failed: ${error}`));
    }
  }

  /**
   * Handle encrypted message data
   */
  /**
   * Handle encrypted message data
   * All messages after handshake must be framed (0x42...0x43) and encrypted.
   * This includes the authorization message {uniqueId, token}.
   */
  private handlePackets(): void {
    try {
      if (!this.aes) {
        this.emit("error", new Error("AES not initialized"));
        return;
      }

      let [packet, remainder] = readPacket(this.buf);
      while (packet) {
        try {
          const decrypted = this.aes.decrypt(unescapePacket(packet));
          const message: ProtocolMessage = JSON.parse(
            decrypted.toString("utf8")
          );
          this.handleMessage(message);
        } catch (e) {
          console.error("Packet parsing error:", e);
        }

        this.buf = remainder;
        [packet, remainder] = readPacket(this.buf);
      }
    } catch (error) {
      this.emit(
        "error",
        new Error(`Failed to process encrypted data: ${error}`)
      );
    }
  }

  /**
   * Handle a parsed protocol message
   */
  private handleMessage(message: ProtocolMessage): void {
    // If not authenticated, expect authorization message
    if (!this.authenticated) {
      this.handleAuthorizationMessage(message);
    } else {
      this.emit("message", message);
    }
  }

  /**
   * Handle authorization message
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAuthorizationMessage(message: any): void {
    // Authorization message should have uniqueId and token
    if (message.uniqueId && message.token) {
      this.uniqueId = message.uniqueId;
      this.emit("authorization", {
        uniqueId: message.uniqueId,
        token: message.token,
      });
    } else {
      this.emit("error", new Error("Invalid authorization message"));
    }
  }

  /**
   * Mark client as authenticated
   */
  setAuthenticated(userId: string): void {
    this.authenticated = true;
    this.userId = userId;
    this.emit("authenticated", userId);
  }

  /**
   * Send a message to the client
   */
  sendMessage(message: ProtocolMessage): void {
    if (!this.aes) {
      throw new Error("Cannot send message: AES not initialized");
    }

    try {
      const payload = JSON.stringify(message, null, 0);
      const buffer = this.aes.encrypt(Buffer.from(payload, "utf8"));
      const packet = escapePacket(buffer);
      this.socket.write(
        Buffer.concat([Buffer.from([0x42]), packet, Buffer.from([0x43])])
      );
    } catch (error) {
      this.emit("error", new Error(`Failed to send message: ${error}`));
    }
  }

  /**
   * Check if client is authenticated
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * Get user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Get unique ID
   */
  getUniqueId(): string | null {
    return this.uniqueId;
  }

  /**
   * Close the connection
   */
  close(): void {
    this.socket.end();
  }
}
