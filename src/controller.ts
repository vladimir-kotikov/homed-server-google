import * as Sentry from "@sentry/node";
import debug from "debug";
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
import { WebApp } from "./web/app.ts";

const log = debug("homed:controller");
const logError = debug("homed:controller:error");

const topicToDeviceId = (topic: string): DeviceId =>
  topic.split("/").slice(1).join("/") as DeviceId;

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

  private clients: Record<UserId, Record<ClientId, ClientConnection<User>>> =
    {};

  constructor(
    userDatabase: UserRepository,
    deviceCache: DeviceRepository,
    httpHandler: WebApp,
    sslOptions?: { cert: string; key: string }
  ) {
    this.userDb = userDatabase;
    this.httpHandler = httpHandler;
    this.deviceCache = deviceCache;

    this.httpServer = sslOptions
      ? https.createServer(sslOptions)
      : http.createServer();

    this.httpServer
      .on("request", this.httpHandler.handleRequest)
      .on("error", error => {
        logError("HTTP(S) Server error:", error);
        this.stop();
      });

    this.tcpServer = net
      .createServer({ keepAlive: true, allowHalfOpen: false })
      .on("connection", this.clientConnected)
      .on("error", error => {
        logError("TCP Server error:", error);
        this.stop();
      });
  }

  start(httpPort: number, tcpPort: number) {
    this.httpServer.listen(httpPort);
    this.tcpServer.listen(tcpPort);

    const protocol = this.httpServer instanceof https.Server ? "https" : "http";
    log(`HTTP Server listening on port ${protocol}://0.0.0.0:${httpPort}`);
    log(`TCP Server listening on port tcp://0.0.0.0:${tcpPort}`);
  }

  stop = () =>
    Promise.all([
      promisify(this.httpServer.close.bind(this.httpServer))(),
      promisify(this.tcpServer.close.bind(this.tcpServer))(),
    ]).then(() => this.userDb.close());

  clientConnected = (socket: net.Socket) => {
    const client = new ClientConnection<User>(socket)
      .on("close", () => this.clientDisconnected(client))
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
      .on("fd", (topic, data) =>
        this.deviceDataUpdated(client, topicToDeviceId(topic), data)
      );

    log(`New connection from ${socket.remoteAddress}:${socket.remotePort}`);
  };

  clientDisconnected = (client: ClientConnection<User>) => {
    if (client.user && client.uniqueId) {
      delete this.clients[client.user.id]?.[client.uniqueId];
      this.deviceCache.removeDevices(client.user.id, client.uniqueId);
      log(`Client disconnected: ${client.uniqueId}`);
    }
  };

  clientTokenReceived = (
    client: ClientConnection<User>,
    token: ClientToken
  ) => {
    const uniqueId = client.uniqueId;
    if (!uniqueId) {
      logError(`Client has no unique ID, cannot authorize`);
      client.close();
      return;
    }

    this.userDb
      .getByToken(token)
      .then(user => {
        if (!user) {
          client.close();
          logError(`Client ${uniqueId} unauthorized: user not found`);
          return;
        }

        client.authorize(user);
        this.clients[user.id] = this.clients[user.id] || {};
        this.clients[user.id][uniqueId] = client;
        log(`Client ${uniqueId} authorized for ${user.username}`);
      })
      .catch(error => {
        logError(
          `Error during token authentication for client ${uniqueId}:`,
          error
        );
        Sentry.captureException(error, {
          tags: { component: "client-auth" },
          extra: { uniqueId, token },
        });
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

    log(
      `Client status update from ${client.uniqueId} . Devices: ${message.devices?.length ?? 0}`
    );

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
            key: `zigbee/${device.ieeeAddress}`,
            topic: `zigbee/${byName ? device.name : device.ieeeAddress}`,
            name: device.name,
            description: device.description,
            manufacturer: device.manufacturerName,
            model: device.modelName,
            firmware: device.firmware,
            version: device.version,
            available: false,
            endpoints: [],
          }) as HomedDevice
      );

    const [added] = this.deviceCache.syncClientDevices(
      client.user.id,
      client.uniqueId,
      homedDevices
    );

    if (added.length > 0) {
      added.forEach(({ topic }) => {
        client.subscribe(`expose/${topic}`);
        client.subscribe(`device/${topic}`);
        client.subscribe(`fd/${topic}`); // Subscribe to device state updates
        // Note: Homed client proactively publishes data to these topics
        // No need to request - just wait for the client to publish
      });
    }

    // Device sync event emitted by DeviceRepository, handled by FulfillmentController
  };

  clientDeviceUpdated = (
    client: ClientConnection<User>,
    deviceId: DeviceId,
    message: DeviceExposesMessage
  ) => {
    if (!client.uniqueId || !client.user) return;

    log(
      `Device exposes update from ${client.uniqueId}. ${deviceId}: ${JSON.stringify(message)}`
    );

    const device = this.deviceCache.getClientDevice(
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
          device,
          exposes,
          options: options as EndpointOptions,
        }) satisfies HomedEndpoint
    );

    // Update device capabilities in repository (emits event for Google SYNC)
    this.deviceCache.updateDeviceCapabilities(
      client.user.id,
      client.uniqueId,
      deviceId,
      endpoints
    );

    device.endpoints.forEach(endpoint =>
      client.subscribe(
        endpoint.id ? `status/${deviceId}/${endpoint.id}` : `status/${deviceId}`
      )
    );

    client.publish(`command/${device.topic}`, {
      action: "getProperties",
      device: deviceId,
      service: "cloud",
    });
  };

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
    deviceId: DeviceId,
    data: Record<string, unknown>
  ) => {
    if (!client.user || !client.uniqueId) return;

    log(
      `Device data update from ${client.uniqueId}. ${deviceId}: ${JSON.stringify(data)}`
    );

    // Update device state in cache - state change events handled by DeviceRepository
    this.deviceCache.setDeviceState(
      client.user.id,
      client.uniqueId,
      deviceId,
      data
    );
  };
}
