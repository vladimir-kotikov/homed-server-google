import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { match, P } from "ts-pattern";
import {
  ClientMessageSchema,
  DeviceExposesMessageSchema,
  DeviceListMessageSchema,
  DeviceStateMessageSchema,
  DeviceStatusMessageSchema,
  type ServerMessage,
} from "../schemas/homed.schema.ts";
import { AES128CBC } from "./crypto.ts";
import { escapePacket, readPacket, unescapePacket } from "./protocol.ts";

/**
 * Represents a single TCP client connection. Encapsulates the socket,
 * handles the DH handshake, encryption/decryption, and message parsing.
 */

export class ClientConnection extends EventEmitter<{
  error: [Error];
  close: [];
  tokenReceived: [string];
  devicesUpdated: [Array<Record<string, unknown>> | undefined];
  dataUpdated: [Record<string, unknown>];
}> {
  private socket: Socket;
  private cipher?: AES128CBC;
  private clientAuthorized = false;
  private buf: Buffer = Buffer.alloc(0);
  private timeout: NodeJS.Timeout;
  uniqueId?: string;

  constructor(socket: Socket, timeout: number = 10_000) {
    super();
    this.socket = socket
      .on("data", (data: Buffer) => {
        this.receiveData(data);
      })
      .on("error", (error: Error) => {
        this.emit("error", error);
      })
      .on("close", () => {
        this.emit("close");
      });

    this.timeout = setTimeout(() => {
      if (!this.cipher) {
        console.error("Handshake timeout: no data received");
        this.socket.end();
      }

      if (!this.clientAuthorized) {
        console.error("Authorization timeout: client not authorized");
        this.socket.end();
      }
    }, timeout);
  }

  /**
   * Handle DH handshake data (12 bytes)
   * Protocol: client sends [prime(4), generator(4), publicKey(4)] in big-endian
   */
  private ensureHandshakePerformed(): boolean {
    if (this.cipher) {
      return true;
    }

    if (this.buf.length < 12) {
      return false;
    }

    try {
      const handshake = this.buf.subarray(0, 12);
      const [cipher, publicKey] = AES128CBC.fromHandshake(handshake);

      this.cipher = cipher;
      this.buf = this.buf.subarray(12); // Remove handshake data from buffer
      this.socket.write(publicKey);
      return true;
    } catch (error) {
      console.error(`Handshake failed: ${error}`);
    }

    return false;
  }

  private ensureAuthenticated(): boolean {
    if (this.clientAuthorized) {
      return true;
    }

    if (this.uniqueId) {
      // Short-circuit if token is sent by the client but
      // authorization is not yet confirmed by the server
      return false;
    }

    const [packet, remainder] = readPacket(this.buf);
    if (packet) {
      const decrypted = this.cipher!.decrypt(unescapePacket(packet));
      const message = JSON.parse(decrypted.toString("utf8"));
      if (message && message.token && message.uniqueId) {
        this.emit("tokenReceived", message.token);
        this.uniqueId = message.uniqueId;
        this.buf = remainder;
      }
    }

    return false;
  }

  private receiveData(data: Buffer): void {
    this.buf = Buffer.concat([this.buf, data]);

    if (!this.ensureHandshakePerformed() || !this.ensureAuthenticated()) {
      return;
    }

    let [packet, remainder] = readPacket(this.buf);
    while (packet) {
      const decrypted = this.cipher!.decrypt(unescapePacket(packet));
      const message = JSON.parse(decrypted.toString("utf8"));

      this.handleMessage(message);

      this.buf = remainder;
      [packet, remainder] = readPacket(this.buf);
    }
  }

  /**
   * Handle a parsed protocol message
   */
  private handleMessage(message: unknown): void {
    const { data, success } = ClientMessageSchema.safeParse(message);
    if (!success) {
      return;
    }

    match(data)
      .with(
        { topic: P.string.startsWith("status/"), message: P.select() },
        message_ => {
          const { data, success, error } =
            DeviceListMessageSchema.safeParse(message_);
          if (success) {
            return this.emit("devices", data);
          }
          console.warn("Invalid device list message received:", error);
        }
      )
      .with(
        { topic: P.string.startsWith("expose/"), message: P.select() },
        message_ => {
          const { data, success, error } =
            DeviceExposesMessageSchema.safeParse(message_);
          if (success) {
            return this.emit("exposes", data);
          }
          console.warn("Invalid expose message received:", error);
        }
      )
      .with(
        { topic: P.string.startsWith("device/"), message: P.select() },
        message_ => {
          const { data, success, error } =
            DeviceStatusMessageSchema.safeParse(message_);
          if (success) {
            return this.emit("status", data);
          }
          console.warn("Invalid device status message received:", error);
        }
      )
      .with(
        { topic: P.string.startsWith("fd/"), message: P.select() },
        message_ => {
          const { data, success, error } =
            DeviceStateMessageSchema.safeParse(message_);
          if (success) {
            return this.emit("state", data);
          }
          console.warn("Invalid device readings message received:", error);
        }
      )
      .otherwise(() =>
        console.warn("Unknown message topic received:", data.topic)
      );
  }

  /**
   * Send a message to the client
   */
  sendMessage(message: ServerMessage): void {
    if (!this.cipher) {
      throw new Error("Cannot send message: AES not initialized");
    }

    try {
      const payload = JSON.stringify(message, undefined, 0);
      const buffer = this.cipher.encrypt(Buffer.from(payload, "utf8"));
      const packet = escapePacket(buffer);
      this.socket.write(
        Buffer.concat([Buffer.from([0x42]), packet, Buffer.from([0x43])])
      );
    } catch (error) {
      this.emit("error", new Error(`Failed to send message: ${error}`));
    }
  }

  authorize(): void {
    this.clientAuthorized = true;
    clearTimeout(this.timeout);
  }

  close(): void {
    this.socket.end();
    clearTimeout(this.timeout);
  }
}
