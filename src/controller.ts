import * as Sentry from "@sentry/node";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { promisify } from "node:util";
import {
  UserRepository,
  type ClientToken,
  type User,
  type UserId,
} from "./db/repository.ts";
import type {
  DeviceId,
  DeviceRepository,
  HomedDevice,
  HomedEndpoint,
} from "./device.ts";
import { ClientConnection, type ClientId } from "./homed/client.ts";
import type {
  ClientStatusMessage,
  DeviceExposesMessage,
  DeviceStatusMessage,
  EndpointOptions,
} from "./homed/schema.ts";
import type { CommandMessage } from "./homed/types.ts";
import { createLogger } from "./logger.ts";
import { cloak, truncate } from "./utility.ts";
import { WebApp } from "./web/app.ts";

const log = createLogger("controller");

/**
 * Parse device ID and optional endpoint ID from topic
 * Examples:
 *   - "fd/zigbee/device" → {deviceId: "zigbee/device", endpointId: undefined}
 *   - "fd/zigbee/device/1" → {deviceId: "zigbee/device", endpointId: 1}
 */
const parseTopicDeviceId = (
  topic: string
): { deviceId: DeviceId; endpointId?: number } => {
  const parts = topic.split("/").slice(1); // Remove topic prefix (fd, device, etc)

  // Check if last part is a numeric endpoint ID
  const lastPart = parts[parts.length - 1];
  if (lastPart && /^\d+$/.test(lastPart)) {
    const endpointId = parseInt(lastPart, 10);
    const deviceId = parts.slice(0, -1).join("/") as DeviceId;
    return { deviceId, endpointId };
  }

  return { deviceId: parts.join("/") as DeviceId };
};

const topicToDeviceId = (topic: string): DeviceId =>
  parseTopicDeviceId(topic).deviceId;

/**
 * A main controller that wires up HTTP and TCP servers and manages clients and
 * users.
 *
 * This service uses the cached device data managed by TCPServer.
 * Device information is populated from MQTT messages received from TCP clients
 * and cached automatically by the server.
 *
 * Entity mapping is as follows:
 * User   1---N Client
 * Client 1---N Device
 */

export class HomedServerController {
  private httpServer: http.Server | https.Server;
  private tcpServer: net.Server;
  private userDb: UserRepository;
  private httpHandler: WebApp;
  private deviceCache: DeviceRepository;

  private healthcheckIps: Set<string>;
  private maxConnections: number;
  private maxConnectionsPerUser: number;

  private clients: Record<UserId, Record<ClientId, ClientConnection<User>>> =
    {};

  constructor(
    userDatabase: UserRepository,
    deviceCache: DeviceRepository,
    httpHandler: WebApp,
    sslOptions?: { cert: string; key: string },
    healtcheckIps: string[] = [],
    maxConnections: number = 100,
    maxConnectionsPerUser: number = 5
  ) {
    this.userDb = userDatabase;
    this.httpHandler = httpHandler;
    this.deviceCache = deviceCache;
    this.healthcheckIps = new Set(healtcheckIps);
    this.maxConnections = maxConnections;
    this.maxConnectionsPerUser = maxConnectionsPerUser;

    this.httpServer = sslOptions
      ? https.createServer(sslOptions)
      : http.createServer();

    this.httpServer
      .on("request", this.httpHandler.handleRequest)
      .on("error", error => {
        log.error("server.http_error", error);
        this.stop();
      });

    this.tcpServer = net
      .createServer({ keepAlive: true, allowHalfOpen: false })
      .on("connection", this.clientConnected)
      .on("error", error => {
        log.error("server.tcp_error", error);
        this.stop();
      });

    // Subscribe to command execution events from device repository
    this.deviceCache.on("executeCommand", this.handleExecuteCommand);
  }

  /**
   * Handle command execution events from device repository
   * Constructs topic from deviceId and endpointId, then sends to TCP client
   */
  private handleExecuteCommand = ({
    userId,
    clientId,
    deviceId,
    endpointId,
    message,
  }: {
    userId: UserId;
    clientId: ClientId;
    deviceId: DeviceId;
    endpointId?: number;
    message: CommandMessage;
  }): void => {
    const client = this.clients[userId]?.[clientId];
    Sentry.setContext("client", { clientId });
    Sentry.setContext("homed.device", { deviceId, endpointId });

    if (!client) {
      log.error("command.error", undefined, {
        reason: "unknown_client",
      });
      return;
    }

    // Construct topic: td/{deviceId} or td/{deviceId}/{endpointId}
    const topic =
      endpointId !== undefined
        ? `td/${deviceId}/${endpointId}`
        : `td/${deviceId}`;

    log.debug("command.execute", {
      ...message,
      ...(message.message ? { message: truncate(message.message, 50) } : {}),
    });

    try {
      client.sendMessage({
        action: "publish",
        topic,
        message,
      });
    } catch (error) {
      log.error("command.error", error);
    }
  };

  start = (httpPort: number, tcpPort: number) => {
    this.httpServer.listen(httpPort);
    this.tcpServer.listen(tcpPort);

    const protocol = this.httpServer instanceof https.Server ? "https" : "http";
    log.info(`HTTP Server listening on port ${protocol}://0.0.0.0:${httpPort}`);
    log.info(`TCP Server listening on port tcp://0.0.0.0:${tcpPort}`);
  };

  stop = () =>
    Promise.allSettled([
      ...Object.entries(this.clients)
        .flatMap(([, clients]) => Object.values(clients))
        .map(client => client.close()),
      promisify(this.httpServer.close.bind(this.httpServer))(),
      promisify(this.tcpServer.close.bind(this.tcpServer))(),
    ]).then(() => this.userDb.close());

  clientConnected = (socket: net.Socket) => {
    // Attach early to prevent ECONNRESET from becoming an uncaught exception
    // if the peer resets before ClientConnection registers its own handler.
    // ClientConnection will add its own listener for the normal path.
    socket.on("error", () => {});

    if (
      !socket.remoteAddress ||
      this.healthcheckIps.has(socket.remoteAddress)
    ) {
      log.debug("connection.healthcheck");
      socket.write("OK");
      socket.end();
      return;
    }

    if (this.tcpServer.connections > this.maxConnections) {
      log.info("connection.refuse", { reason: "server_full" });
      socket.write("Server is at capacity, try again later");
      socket.end();
      return;
    }

    log.info("connection.accept");
    const client = new ClientConnection<User>(socket)
      .on("error", error => log.error("connection.error", error))
      .on("close", () => {
        this.tcpServer.getConnections((_, count) =>
          Sentry.metrics.gauge("connections.active", count)
        );
        return this.clientDisconnected(client);
      })
      .on("token", token => this.clientTokenReceived(client, token))
      // status/# subscription
      .on("status", (topic, message) =>
        this.clientStatusUpdated(client, topicToDeviceId(topic), message)
      )
      .on("device", (topic, message) =>
        this.deviceStatusUpdated(client, topicToDeviceId(topic), message)
      )
      .on("expose", (topic, devices) =>
        this.clientDeviceUpdated(client, topicToDeviceId(topic), devices)
      )
      .on("fd", (topic, data) => this.deviceDataUpdated(client, topic, data));

    this.tcpServer.getConnections((_, count) =>
      Sentry.metrics.gauge("connections.active", count)
    );
  };

  clientDisconnected = (client: ClientConnection<User>) => {
    if (client.user && client.uniqueId) {
      delete this.clients[client.user.id]?.[client.uniqueId];
      this.deviceCache.removeClientDevices(client.user.id, client.uniqueId);
    }
    log.debug("connection.close");
  };

  clientTokenReceived = (
    client: ClientConnection<User>,
    token: ClientToken
  ) => {
    const uniqueId = client.uniqueId;
    if (!uniqueId) {
      log.error(`client.auth`, { reason: "missing_unique_id" });
      client.close();
      return;
    }

    this.userDb
      .getByToken(token)
      .then(user => {
        if (!user) {
          client.close();
          log.error(`client.auth`, {
            reason: "invalid_token",
            token: cloak(token, 4),
          });
          return;
        }

        if (
          this.clients[user.id] &&
          Object.keys(this.clients[user.id]).length >=
            this.maxConnectionsPerUser
        ) {
          log.info("connection.refused", {
            reason: "user_limit",
            userId: user.id,
          });
          client.close();
          return;
        }

        client.authorize(user);
        this.clients[user.id] = this.clients[user.id] || {};
        this.clients[user.id][uniqueId] = client;
        log.debug(`client.auth`, { userId: user.id, uniqueId });
      })
      .catch(error => {
        log.error(`client.auth`, error, { reason: "db_error", uniqueId });
        client.close();
      });
  };

  clientStatusUpdated = (
    client: ClientConnection<User>,
    // unused for now, since we only support zigbee devices
    _topic: string,
    message: ClientStatusMessage
  ) => {
    if (!client.uniqueId || !client.user) return;

    log.debug("message.devices", {
      devices: message.devices?.length ?? 0,
    });

    // TODO: This method only concerned with zigbee devices, as others
    // are not yet supported in the Homed server. Once other device types
    // are supported, this method should be updated accordingly.
    const { devices, names: byName } = message;
    if (!devices) return;

    const homedDevices = devices
      .filter(
        ({ name, removed, cloud }) =>
          name && name !== "HOMEd Coordinator" && cloud && !removed
      )
      .map(
        device =>
          ({
            key: `zigbee/${device.ieeeAddress}` as DeviceId,
            topic: `zigbee/${byName ? device.name : device.ieeeAddress}`,
            name: device.name,
            description: device.description,
            manufacturer: device.manufacturerName,
            model: device.modelName,
            firmware: device.firmware,
            version: device.version,
            endpoints: [],
            available: device.active !== false, // treat absent as online
          }) as HomedDevice
      );

    const [added] = this.deviceCache.syncClientDevices(
      client.user.id,
      client.uniqueId,
      homedDevices
    );

    added.forEach(({ topic }) => {
      client.subscribe(`expose/${topic}`);
      client.subscribe(`device/${topic}`);
    });
  };

  clientDeviceUpdated = (
    client: ClientConnection<User>,
    deviceId: DeviceId,
    message: DeviceExposesMessage
  ) => {
    if (!client.uniqueId || !client.user) return;

    log.debug("message.exposes", {
      deviceId,
      endpoints: Object.keys(message).length,
    });

    const device = this.deviceCache.getDevice(
      client.user.id,
      client.uniqueId,
      deviceId
    );
    if (!device) return;

    const endpoints = Object.entries(message).map(
      ([rawId, { items: exposes, options }]) =>
        ({
          // id can be either "1", "2", ... or some string (usually "common")
          // meaning the device exposes some of the capabilities "directly"
          id: isNaN(parseInt(rawId, 10)) ? 0 : parseInt(rawId, 10),
          exposes,
          options: options as EndpointOptions,
        }) satisfies HomedEndpoint
    );

    endpoints.forEach(endpoint => {
      const topic = endpoint.id
        ? `fd/${deviceId}/${endpoint.id}`
        : `fd/${deviceId}`;

      log.debug("message.subscribe", { topic });
      client.subscribe(topic);
    });

    client.command("getProperties", device.key);

    // Update device capabilities in repository (emits event for Google SYNC)
    this.deviceCache.updateDevice(
      client.user.id,
      client.uniqueId,
      deviceId,
      endpoints
    );
  };

  // device/ topic handler
  deviceStatusUpdated = (
    client: ClientConnection<User>,
    deviceId: DeviceId,
    { status }: DeviceStatusMessage
  ) =>
    client.user &&
    client.uniqueId &&
    this.deviceCache.setDeviceAvailable(
      client.user.id,
      client.uniqueId,
      deviceId,
      status === "online"
    );

  deviceDataUpdated = (
    client: ClientConnection<User>,
    topic: string,
    data: Record<string, unknown>
  ) => {
    if (!client.user || !client.uniqueId) return;

    const { deviceId, endpointId } = parseTopicDeviceId(topic);

    log.debug("message.state", {
      deviceId,
      ...(endpointId ? { endpointId } : {}),
    });

    // Update device state in cache with endpoint-specific data
    // (this implicitly records device as seen for the inactivity watchdog)
    this.deviceCache.updateDeviceState(
      client.user.id,
      client.uniqueId,
      deviceId,
      data,
      endpointId
    );
  };
}
