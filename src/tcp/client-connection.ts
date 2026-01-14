import { EventEmitter } from "events";
import { Socket } from "net";
import {
  AES128CBC,
  deriveMD5Key,
  DHKeyExchange,
  padBuffer,
  unpadBuffer,
} from "./crypto";
import { MessageFramer, ProtocolMessage } from "./protocol";

/**
 * Represents a single TCP client connection
 */
export class ClientConnection extends EventEmitter {
  private socket: Socket;
  private dh: DHKeyExchange | null = null;
  private aes: AES128CBC | null = null;
  private framer: MessageFramer;
  private authenticated = false;
  private userId: string | null = null;
  private uniqueId: string | null = null;
  private handshakeComplete = false;

  constructor(socket: Socket) {
    super();
    this.socket = socket;
    this.framer = new MessageFramer();

    this.setupSocketHandlers();
  }

  /**
   * Set up socket event handlers
   */
  private setupSocketHandlers(): void {
    this.socket.on("data", (data: Buffer) => {
      this.handleData(data);
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
  private handleData(data: Buffer): void {
    if (!this.handshakeComplete) {
      this.handleHandshakeData(data);
    } else {
      this.handleEncryptedData(data);
    }
  }

  /**
   * Handle DH handshake data (12 bytes)
   */
  private handleHandshakeData(data: Buffer): void {
    if (data.length < 12) {
      this.emit("error", new Error("Invalid handshake data length"));
      return;
    }

    try {
      // Read client's DH parameters (big-endian)
      const _clientPrime = data.readUInt32BE(0);
      const _clientGenerator = data.readUInt32BE(4);
      const clientSharedKey = data.readUInt32BE(8);

      // Generate server DH parameters
      this.dh = new DHKeyExchange();
      const serverSharedKey = this.dh.getSharedKey();

      // Compute private key
      const privateKey = this.dh.computePrivateKey(clientSharedKey);

      // Derive AES key and IV
      const aesKey = deriveMD5Key(privateKey);
      const aesIV = deriveMD5Key(aesKey.readUInt32BE(0));

      this.aes = new AES128CBC(aesKey, aesIV);

      // Send server's shared key (4 bytes, big-endian)
      const response = Buffer.allocUnsafe(4);
      response.writeUInt32BE(serverSharedKey, 0);
      this.socket.write(response);

      this.handshakeComplete = true;
      this.emit("handshake-complete");
    } catch (error) {
      this.emit("error", new Error(`Handshake failed: ${error}`));
    }
  }

  /**
   * Handle encrypted message data
   */
  private handleEncryptedData(data: Buffer): void {
    if (!this.aes) {
      this.emit("error", new Error("AES not initialized"));
      return;
    }

    try {
      // Unframe messages
      const messages = this.framer.unframe(data);

      for (const encryptedMessage of messages) {
        // Decrypt message
        const decryptedData = this.aes.decrypt(encryptedMessage);
        const unpaddedData = unpadBuffer(decryptedData);

        // Parse JSON
        const json = unpaddedData.toString("utf8");
        const message: ProtocolMessage = JSON.parse(json);

        this.handleMessage(message);
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
      // Serialize to JSON
      const json = JSON.stringify(message);
      const buffer = Buffer.from(json, "utf8");

      // Pad to 16-byte boundary
      const padded = padBuffer(buffer);

      // Encrypt
      const encrypted = this.aes.encrypt(padded);

      // Frame
      const framed = this.framer.frame(encrypted);

      // Send
      this.socket.write(framed);
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
