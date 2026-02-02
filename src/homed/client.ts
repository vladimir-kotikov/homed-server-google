import debug from "debug";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { match, P } from "ts-pattern";
import type { ClientToken } from "../db/repository.ts";
import { safeParse } from "../utility.ts";
import { AES128CBC } from "./crypto.ts";
import { escapePacket, readPacket, unescapePacket } from "./protocol.ts";
import {
  ClientMessageSchema,
  ClientStatusMessageSchema,
  DeviceExposesMessageSchema,
  DeviceStateMessageSchema,
  DeviceStatusMessageSchema,
  type ClientStatusMessage,
  type DeviceExposesMessage,
  type DeviceStatusMessage,
  type ServerMessage,
} from "./schema.ts";

const log = debug("homed:client");
const logError = debug("homed:client:error");

export type ClientId = string & { readonly __uniqueId: unique symbol };

/**
 * Represents a single TCP client connection. Encapsulates the socket,
 * handles the DH handshake, encryption/decryption, and message parsing.
 */

export class ClientConnection<U> extends EventEmitter<{
  error: [Error];
  close: [];
  token: [ClientToken];
  device: [string, DeviceStatusMessage];
  expose: [string, DeviceExposesMessage];
  status: [string, ClientStatusMessage];
  fd: [string, Record<string, unknown>];
}> {
  private buf: Buffer = Buffer.alloc(0);
  private socket: Socket;
  private cipher?: AES128CBC;
  private timeout: NodeJS.Timeout;
  uniqueId?: ClientId;
  user?: U;

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
      const message = this.cipher
        ? "Authorization timeout: client not authorized"
        : "Handshake timeout: no data received";

      logError(message);
      this.close();
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
    } catch (error_) {
      logError(`Handshake failed: ${error_}`);
    }

    return false;
  }

  private ensureAuthenticated(): boolean {
    if (this.user) {
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
        this.uniqueId = message.uniqueId;
        this.emit("token", message.token);
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

  private handleMessage(rawMessage: unknown): void {
    const { data, success } = ClientMessageSchema.safeParse(rawMessage);
    if (!success) {
      return;
    }

    const { topic, message } = data;
    match(topic)
      .with(P.string.startsWith("status/"), () =>
        safeParse(message, ClientStatusMessageSchema)
          .then(data => this.emit("status", topic, data))
          .catch(error =>
            logError(
              "Invalid client status message received:",
              error,
              JSON.stringify(message, undefined, 0)
            )
          )
      )
      .with(P.string.startsWith("expose/"), () =>
        safeParse(message, DeviceExposesMessageSchema)
          .then(data => this.emit("expose", topic, data))
          .catch(error =>
            logError(
              "Invalid expose message received:",
              error,
              JSON.stringify(message, undefined, 0)
            )
          )
      )
      .with(P.string.startsWith("device/"), () =>
        safeParse(message, DeviceStatusMessageSchema)
          .then(data => this.emit("device", topic, data))
          .catch(error =>
            logError(
              "Invalid device status message received:",
              error,
              JSON.stringify(message, undefined, 0)
            )
          )
      )
      .with(P.string.startsWith("fd/"), () => {
        safeParse(message, DeviceStateMessageSchema)
          .then(data => this.emit("fd", topic, data))
          .catch(error =>
            logError(
              "Invalid device state message received:",
              error,
              JSON.stringify(message, undefined, 0)
            )
          );
      })
      .otherwise(() => logError("Unknown message topic received:", data.topic));
  }

  // Public solely for testing purposes
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
      log(`Sent message to ${this.uniqueId ?? "unknown client"}:`, message);
    } catch (error) {
      this.emit("error", new Error(`Failed to send message: ${error}`));
    }
  }

  subscribe = (topic: string): void =>
    this.sendMessage({ action: "subscribe", topic });

  publish = (topic: string, message: Record<string, unknown>): void =>
    this.sendMessage({ action: "publish", topic, message });

  authorize(user: U): void {
    this.user = user;
    this.sendMessage({ action: "subscribe", topic: "status/#" });
    clearTimeout(this.timeout);
  }

  close(): void {
    clearTimeout(this.timeout);
    this.socket.end();
  }
}
