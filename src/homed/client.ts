import * as Sentry from "@sentry/node";
import debug from "debug";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import { match, P } from "ts-pattern";
import type { ClientToken } from "../db/repository.ts";
import type { DeviceId } from "../device.ts";
import { Result, safeParse } from "../utility.ts";
import { AES128CBC } from "./crypto.ts";
import { escapePacket, readPacket, unescapePacket } from "./protocol.ts";
import {
  ClientAuthMessageSchema,
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

const logDebug = debug("homed:client:debug");
const logError = debug("homed:client:error");

export type ClientId = string & { readonly __uniqueId: unique symbol };

/**
 * Represents a single TCP client connection. Encapsulates the socket,
 * handles the DH handshake, encryption/decryption, and message parsing.
 */

export class ClientConnection<U extends { id: string }> extends EventEmitter<{
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
  private maxBufferSize: number;
  uniqueId?: ClientId;
  user?: U;

  constructor(
    socket: Socket,
    timeout: number = 10_000,
    maxBufferSize: number = 100 * 2 ** 10 // 10 kB
  ) {
    super();
    this.maxBufferSize = maxBufferSize;
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
    } catch (err) {
      logError(`Handshake failed: ${err}`);
      this.close();
    }

    return false;
  }

  private receiveData(data: Buffer): void {
    this.buf = Buffer.concat([this.buf, data]);
    if (this.buf.length > this.maxBufferSize) {
      logError(
        `Buffer size exceeded limit (${this.buf.length} bytes) for client ${this.uniqueId ?? "unknown"} (user: ${this.user?.id ?? "not authorized"})`
      );
      Sentry.captureMessage("Client buffer size exceeded", {
        level: "warning",
        tags: {
          "client.unique_id": this.uniqueId ?? "not authenticated",
          "client.user_id": this.user?.id ?? "not authenticated",
        },
        extra: {
          bufferSize: this.buf.length,
          maxBufferSize: this.maxBufferSize,
        },
      });
      this.close();
      return;
    }

    if (!this.ensureHandshakePerformed()) {
      return;
    }

    let [packet, remainder] = readPacket(this.buf);
    while (packet && !this.socket.closed) {
      let message: unknown;
      let decrypted: Buffer;
      try {
        decrypted = this.cipher!.decrypt(unescapePacket(packet));
        message = JSON.parse(decrypted.toString("utf8"));
        logDebug(
          `Received message from ${this.uniqueId ?? "unknown client"}`,
          message
        );
      } catch (error) {
        logError(`Failed to decrypt or parse message: ${error}`);
        Sentry.captureException(error, {
          tags: {
            "client.unique_id": this.uniqueId ?? "not authenticated",
            "client.user_id": this.user?.id ?? "not authenticated",
          },
        });
        this.close();
        return;
      }

      if (!this.user && !this.uniqueId) {
        safeParse(message, ClientAuthMessageSchema).fold(
          err => {
            logError(`Invalid authentication message: ${err}`);
            this.close();
          },
          ({ uniqueId, token }) => {
            this.uniqueId = uniqueId as ClientId;
            this.emit("token", token as ClientToken);
          }
        );

        this.buf = remainder;
        continue;
      }

      // Stop processing if not yet fully authorized (both uniqueId and user must be set)
      // Messages will remain in buffer and be processed after authorization completes
      if (!this.user) {
        logDebug(
          `Pausing message processing for client ${this.uniqueId} - waiting for authorization`
        );
        break;
      }

      Sentry.startSpan(
        {
          forceTransaction: true,
          name: "client message",
          op: "queue.process",
          attributes: { "messaging.message.body.size": decrypted.length },
        },
        span => {
          // Set up Sentry context for the entire transaction
          Sentry.setContext("client", {
            userId: this.user?.id,
            clientId: this.uniqueId,
          });

          return this.parseMessage(message).fold(
            error => {
              logError(
                `Invalid message from client ${this.uniqueId ?? "unknown"} (user: ${this.user?.id ?? "not authorized"}). Raw message: ${JSON.stringify(message).substring(0, 200)}`,
                error
              );
              // Only close connection if client is fully authorized (has user)
              // During authorization window, just skip invalid messages
              if (this.user) {
                logError(
                  `Closing connection due to invalid message from authorized client`
                );
                this.close();
              }
            },
            ([event, topic, data]) => {
              // Extract deviceId from topic if present (e.g., "fd/deviceId" -> "deviceId")
              let topicName = topic;
              const topicParts = topic.split("/");
              if (topicParts.length > 1) {
                Sentry.setContext("device", {
                  deviceId: topicParts.slice(1).join("/"),
                });
                topicName = topicParts.slice(0, 2).join("/") + "/{deviceId}";
              }
              span.setAttributes({ "messaging.destination.name": topicName });

              this.emit(event, topic, data);
            }
          );
        }
      );

      this.buf = remainder;
      [packet, remainder] = readPacket(this.buf);
    }
  }

  private parseMessage = (
    rawMessage: unknown
  ): Result<[string, string, unknown]> => {
    return safeParse(rawMessage, ClientMessageSchema).map(
      ({ topic, message }) => {
        const event = topic.split("/")[0];
        return match(topic)
          .with(P.string.startsWith("status/"), () =>
            safeParse(message, ClientStatusMessageSchema)
          )
          .with(P.string.startsWith("expose/"), () =>
            safeParse(message, DeviceExposesMessageSchema)
          )
          .with(P.string.startsWith("device/"), () =>
            safeParse(message, DeviceStatusMessageSchema)
          )
          .with(P.string.startsWith("fd/"), () =>
            safeParse(message, DeviceStateMessageSchema)
          )
          .otherwise(() => Result.err(`Unknown message topic ${topic}`))
          .map(data => [event, topic, data] as const);
      }
    );
  };

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
      logDebug(
        `Sent message to ${this.uniqueId ?? "unknown client"}:`,
        message
      );
    } catch (error) {
      this.emit("error", new Error(`Failed to send message: ${error}`));
    }
  }

  subscribe = (topic: string): void =>
    this.sendMessage({ action: "subscribe", topic });

  command = (action: string, deviceId: DeviceId): void =>
    // device.topic is zigbee/<device_address>, so the command goes to
    // command/zigbee topic with {device: <device_address>}
    this.sendMessage({
      action: "publish",
      topic: `command/${deviceId.split("/").slice(0, -1).join("/")}`,
      message: {
        action,
        device: deviceId.split("/").slice(-1)[0],
        service: "cloud",
      },
    });

  authorize(user: U): void {
    this.user = user;
    this.sendMessage({ action: "subscribe", topic: "status/#" });
    clearTimeout(this.timeout);

    // Process any buffered messages that arrived during authorization
    if (this.buf.length > 0) {
      logDebug(
        `Processing ${this.buf.length} bytes of buffered data for authorized client ${this.uniqueId}`
      );
      this.receiveData(Buffer.alloc(0));
    }
  }

  close = () => {
    clearTimeout(this.timeout);
    return new Promise<void>(resolve => this.socket.end(() => resolve()));
  };
}
