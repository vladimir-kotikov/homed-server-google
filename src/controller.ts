import debug from "debug";
import assert from "node:assert";
import http from "node:http";
import https from "node:https";
import net from "node:net";
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
import type { HomeGraphClient } from "./google/homeGraph.ts";
import { ClientConnection, type ClientId } from "./homed/client.ts";
import type {
  ClientStatusMessage,
  DeviceExposesMessage,
  DeviceStatusMessage,
  EndpointOptions,
} from "./homed/schema.ts";
import { setNested } from "./utility.ts";
import { WebApp } from "./web/app.ts";

const log = debug("homed:controller");
const logError = debug("homed:controller:error");

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
  private googleHomeGraph?: HomeGraphClient;

  private clients: Record<UserId, Record<ClientId, ClientConnection<User>>> =
    {};

  constructor(
    userDatabase: UserRepository,
    deviceCache: DeviceRepository,
    httpHandler: WebApp,
    homeGraphClient?: HomeGraphClient,
    sslOptions?: { cert: string; key: string }
  ) {
    this.userDb = userDatabase;
    this.httpHandler = httpHandler;
    this.deviceCache = deviceCache;
    this.googleHomeGraph = homeGraphClient;

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

  stop() {
    this.userDb.close();
    this.httpServer.close();
    this.tcpServer.close();
  }

  clientConnected = (socket: net.Socket) => {
    const client = new ClientConnection<User>(socket)
      .on("close", () => this.clientDisconnected(client))
      .on("token", token => this.clientTokenReceived(client, token))
      // status/# subscription
      .on("status", (topic, message) =>
        this.clientStatusUpdated(client, topic, message)
      )
      .on("device", (deviceId, message) =>
        this.deviceStatusUpdated(client, deviceId, message)
      )
      .on("expose", (type_, devices) =>
        this.clientDeviceUpdated(client, type_, devices)
      )
      .on("fd", (topic, data) => this.deviceDataUpdated(client, topic, data));

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

    this.userDb.getByToken(token).then(user => {
      if (!user) {
        client.close();
        logError(`Client ${uniqueId} unauthorized: user not found`);
        return;
      }

      client.authorize(user);
      setNested([user.id, uniqueId], this.clients, client);
      log(`Client ${uniqueId} authorized for ${user.username}`);
    });
  };

  clientStatusUpdated = (
    client: ClientConnection<User>,
    // unused for now, since we only support zigbee devices
    _topic: string,
    message: ClientStatusMessage
  ) => {
    assert(client.user, "Client must be authorized before updating status");
    log(
      `Client status update from ${client.uniqueId} . Devices: ${message.devices?.length ?? 0}`
    );

    // TODO: This method only concerned with zigbee devices, as others are not
    // yet supported in the Homed server. Once other device types are supported,
    // this method should be updated accordingly.
    const { devices, names: byName } = message;
    if (!client.uniqueId) return;
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
          }) as HomedDevice
      );

    const [added, removed] = this.deviceCache.syncClientDevices(
      client.user.id,
      client.uniqueId,
      homedDevices
    );

    if (added.length > 0) {
      added.forEach(({ topic }) => {
        client.subscribe(`expose/${topic}`);
        client.subscribe(`device/${topic}`);
      });
    }

    if (added.length > 0 || removed.length > 0) {
      this.googleHomeGraph?.updateDevices(
        client.user.id,
        this.deviceCache.getDevices(client.user.id, client.uniqueId)
      );
    }
  };

  clientDeviceUpdated = (
    client: ClientConnection<User>,
    deviceId: string,
    message: DeviceExposesMessage
  ) => {
    log(
      `Device exposes update from ${client.uniqueId}. ${deviceId}: ${message.items}`
    );

    if (!client.uniqueId || !client.user) return;
    const device = this.deviceCache.getClientDevice(
      client.user.id,
      client.uniqueId,
      deviceId as DeviceId
    );
    if (!device) return;

    device.endpoints = Object.entries(message).map(
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
    deviceId: string,
    { status }: DeviceStatusMessage
  ) =>
    client.user &&
    client.uniqueId &&
    this.deviceCache.setDeviceStatus(
      client.user.id,
      client.uniqueId,
      deviceId as DeviceId,
      status === "online"
    );

  deviceDataUpdated = (
    client: ClientConnection<User>,
    deviceId: string,
    data: Record<string, unknown>
  ) =>
    client.user &&
    client.uniqueId &&
    this.deviceCache.setDeviceState(
      client.user.id,
      client.uniqueId,
      deviceId as DeviceId,
      data
    );
}
