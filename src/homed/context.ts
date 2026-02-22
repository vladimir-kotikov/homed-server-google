/**
 * Typed Sentry context interfaces and scope-population utilities for
 * TCP client connections.
 *
 * Centralising context shapes here enforces consistent field names across
 * all Sentry call-sites (withIsolationScope, authorize, handleExecuteCommand)
 * and eliminates the risk of key-name drift (e.g. "uniqueId" vs "clientId").
 */
import type { Socket } from "node:net";

/** Identifies the logical TCP client within a Sentry event. */
export interface ClientContext extends Record<string, unknown> {
  clientId: string | undefined;
}

/**
 * Raw TCP socket metadata. All fields come directly from the Node.js Socket
 * object and are safe to attach to every data-event isolation scope.
 */
export interface ConnectionContext extends Record<string, unknown> {
  remoteAddress: string | undefined;
  remotePort: number | undefined;
  localAddress: string | undefined;
  localPort: number | undefined;
  /** "IPv4" | "IPv6" */
  family: string | undefined;
}

/** Domain device context — named "homed.device" to avoid collision with
 *  Sentry's built-in hardware "device" context. */
export interface HomedDeviceContext extends Record<string, unknown> {
  deviceId: string | undefined;
  endpointId: number | undefined;
}

/** Build a {@link ConnectionContext} from a live socket. */
export const connectionContextFromSocket = (
  socket: Socket
): ConnectionContext => ({
  remoteAddress: socket.remoteAddress,
  remotePort: socket.remotePort,
  localAddress: socket.localAddress,
  localPort: socket.localPort,
  family: socket.remoteFamily,
});
