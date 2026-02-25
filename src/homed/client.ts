import { SPAN_STATUS_ERROR } from "@sentry/core";
import * as Sentry from "@sentry/node";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import type { ClientToken } from "../db/repository.ts";
import { type DeviceId } from "../device.ts";
import { createLogger } from "../logger.ts";
import { Result, safeParse, truncate } from "../utility.ts";
import { connectionContextFromSocket } from "./context.ts";
import { AES128CBC } from "./crypto.ts";
import { escapePacket, readPacket, unescapePacket } from "./protocol.ts";
import {
  ClientAuthMessageSchema,
  ClientMessageSchema,
  type ClientStatusMessage,
  type DeviceExposesMessage,
  type DeviceStatusMessage,
  type ServerMessage,
} from "./schema.ts";

const log = createLogger("client");

export type ClientId = string & { readonly __uniqueId: unique symbol };

/**
 * Represents a single TCP client connection. Encapsulates the socket,
 * handles the DH handshake, encryption/decryption, and message parsing.
 */

export class ClientConnection<
  U extends { id: string; username?: string },
> extends EventEmitter<{
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
    const connectionContext = connectionContextFromSocket(socket);
    this.socket = socket
      .on("data", (data: Buffer) =>
        Sentry.withIsolationScope(scope => {
          scope.setContext("client", { clientId: this.uniqueId });
          scope.setContext("connection", connectionContext);
          if (this.user) {
            scope.setUser({
              id: this.user.id,
              username: this.user.username,
              ip_address: connectionContext.remoteAddress,
            });
            scope.setTag("userId", this.user.id);
          }

          this.receiveData(data);
        })
      )
      .on("error", error => this.emit("error", error))
      .on("close", () => this.emit("close"));

    this.timeout = setTimeout(() => {
      const message = this.cipher
        ? "connection.auth_timeout"
        : "connection.handshake_timeout";

      log.warn(message);
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
    } catch (error) {
      log.error("connection.handshake_error", error);
      this.close();
    }

    return false;
  }

  private receiveData(data: Buffer): void {
    this.buf = Buffer.concat([this.buf, data]);
    if (this.buf.length > this.maxBufferSize) {
      log.warn("connection.buffer_overflow", {
        bufferSize: this.buf.length,
        maxBufferSize: this.maxBufferSize,
      });
      this.close();
      return;
    }

    if (!this.ensureHandshakePerformed()) {
      return;
    }

    let [packet, remainder] = readPacket(this.buf);
    while (packet && !this.socket.closed) {
      const result = Sentry.startSpan(
        {
          forceTransaction: true,
          name: "client message",
          op: "queue.process",
        },
        span => {
          assert(packet, "Packet is undefined despite loop condition.");

          const parsed = Result.try(packet => {
            log.debug("message.incoming", { size: packet.length });
            span.setAttribute("messaging.message.body.size", packet.length);
            const decrypted = this.cipher!.decrypt(unescapePacket(packet));
            return JSON.parse(decrypted.toString("utf8"));
          }, packet);

          const handled = !this.uniqueId
            ? this.handleAuthMessage(parsed)
            : this.user
              ? this.handleClientMessage(parsed, span)
              : // Stop processing if not yet fully authorized (both uniqueId
                // and user must be set). Messages will remain in buffer and be
                // processed after authorization completes
                Result.of(false);

          return handled.catch(err => {
            span.setStatus({
              code: SPAN_STATUS_ERROR,
              message: "message_error",
            });
            log.error("message.process", err);
            this.close();
            return false;
          });
        }
      );

      if (result.flat() === false) {
        break;
      }

      this.buf = remainder;
      [packet, remainder] = readPacket(this.buf);
    }
  }

  private handleAuthMessage = (message: Result<unknown>): Result<void> =>
    message
      .flatMap(raw => safeParse(raw, ClientAuthMessageSchema))
      .map(({ uniqueId, token }) => {
        Sentry.setContext("client", { clientId: uniqueId });
        this.uniqueId = uniqueId as ClientId;
        this.emit("token", token as ClientToken);
      });

  private handleClientMessage = (
    parsed: Result<unknown>,
    span: Sentry.Span
  ): Result<void> =>
    parsed
      .flatMap(raw => safeParse(raw, ClientMessageSchema))
      .map(({ topic, message }) => {
        // topic is is prefix/zigbee[/deviceAddress[/endpointId]], but to
        // avoid hign cardinality strip device identifiers
        const segments = topic.split("/", 2);
        span.setAttribute(
          "messaging.destination.name",
          segments.join("/") + "/*"
        );

        this.emit(segments[0], topic, message);
      });

  // Public solely for testing purposes
  sendMessage(message: ServerMessage): void {
    if (!this.cipher) {
      // This should never happen in normal operation since sendMessage
      // is only called after authorization, but we check just in case
      // and do not bother to handle gracefully since it would indicate
      // a fundamental protocol violation by the client
      throw new Error("Cannot send message: AES not initialized");
    }

    if (this.socket.closed || !this.socket.writable) {
      log.warn("message.outgoing", {
        reason: "socket_closed",
        message: truncate(message, 100),
      });
      return;
    }

    try {
      const payload = JSON.stringify(message, undefined, 0);
      const buffer = this.cipher.encrypt(Buffer.from(payload, "utf8"));
      const packet = escapePacket(buffer);
      this.socket.write(
        Buffer.concat([Buffer.from([0x42]), packet, Buffer.from([0x43])])
      );
      log.debug(`message.outgoing`, {
        ...message,
        ...(message.message ? { message: truncate(message.message, 50) } : {}),
      });
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
    Sentry.setUser({
      id: this.user.id,
      username: this.user.username,
      ip_address: this.socket.remoteAddress,
    });
    Sentry.setTag("userId", this.user.id);

    this.sendMessage({ action: "subscribe", topic: "status/#" });
    clearTimeout(this.timeout);

    // Process any buffered messages that arrived during authorization
    if (this.buf.length > 0) {
      this.receiveData(Buffer.alloc(0));
    }
  }

  close = () => {
    clearTimeout(this.timeout);
    return new Promise<void>(resolve => this.socket.end(() => resolve()));
  };
}
