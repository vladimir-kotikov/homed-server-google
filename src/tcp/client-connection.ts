import * as crypto from "crypto";
import { EventEmitter } from "events";
import { Socket } from "net";
import { AES128CBC, DHKeyExchange, padBuffer, unpadBuffer } from "./crypto";
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
      // Try to parse as plaintext JSON first (credentials)
      try {
        const jsonString = data.toString("utf8");
        const message = JSON.parse(jsonString);
        // If it has uniqueId and token, treat it as authorization
        if (message.uniqueId && message.token) {
          console.log(`DEBUG: Received plaintext authorization: ${jsonString}`);
          this.handleAuthorizationMessage(message);
          return;
        }
      } catch {
        // Not plaintext JSON, continue with encrypted data handling
      }

      this.handleEncryptedData(data);
    }
  }

  /**
   * Handle DH handshake data (12 bytes)
   * Protocol: client sends [prime(4), generator(4), publicKey(4)] in big-endian
   */
  private handleHandshakeData(data: Buffer): void {
    if (data.length < 12) {
      this.emit("error", new Error("Invalid handshake data length"));
      return;
    }

    try {
      // Read client's DH parameters (big-endian)
      const clientPrime = data.readUInt32BE(0);
      const clientGenerator = data.readUInt32BE(4);
      const clientSharedKey = data.readUInt32BE(8);

      // Create DH instance and set client's parameters
      this.dh = new DHKeyExchange();
      this.dh.setPrime(clientPrime);
      this.dh.setGenerator(clientGenerator);

      // Generate server's public key (using client's p and g)
      const serverSharedKey = this.dh.getSharedKey();

      // Compute shared secret
      const sharedSecret = this.dh.computePrivateKey(clientSharedKey);

      // Derive AES key: MD5(sharedSecret as 4-byte big-endian)
      const sharedSecretBuffer = Buffer.allocUnsafe(4);
      sharedSecretBuffer.writeUInt32BE(sharedSecret, 0);

      const aesKey = crypto
        .createHash("md5")
        .update(sharedSecretBuffer)
        .digest();

      // IV: MD5(entire aesKey) - double MD5 hash per homed-service-cloud protocol
      const aesIV = crypto.createHash("md5").update(aesKey).digest();

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
    try {
      // Try to parse as plaintext JSON first
      const rawString = data.toString("utf8");
      try {
        const message: ProtocolMessage = JSON.parse(rawString);
        console.log(`DEBUG: Received plaintext JSON message: ${rawString}`);
        this.handleMessage(message);
        return;
      } catch {
        // Not plaintext JSON, continue with decryption
      }

      if (!this.aes) {
        this.emit("error", new Error("AES not initialized"));
        return;
      }

      // Unframe messages
      const messages = this.framer.unframe(data);

      for (const encryptedMessage of messages) {
        // Try to decrypt
        const decryptedData = this.aes.decrypt(encryptedMessage);
        const unpaddedData = unpadBuffer(decryptedData);

        // Check if it contains our known token or uniqueId
        const unpaddedString = unpaddedData.toString(
          "utf8",
          0,
          Math.min(unpaddedData.length, 200)
        );
        const unpaddedHex = unpaddedData.toString("hex");

        const hasToken = unpaddedHex.includes(
          "13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e"
        );
        const hasUniqueId = unpaddedString.includes("integration-test-client");

        if (hasToken) {
          console.log(`DEBUG: Found token in decrypted data!`);
          console.log(`DEBUG: Decrypted hex: ${unpaddedHex}`);
        }
        if (hasUniqueId) {
          console.log(`DEBUG: Found uniqueId in decrypted data!`);
          console.log(
            `DEBUG: Decrypted text (first 300 chars): ${unpaddedString}`
          );
        }

        // Parse JSON
        const json = unpaddedData.toString("utf8");
        try {
          const message: ProtocolMessage = JSON.parse(json);
          this.handleMessage(message);
        } catch (parseError) {
          // If JSON parsing fails, log summary
          console.log(
            `DEBUG: Failed to parse as JSON. Data length: ${unpaddedData.length}`
          );
          this.emit(
            "error",
            new Error(`Invalid message format: ${parseError}`)
          );
        }
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
