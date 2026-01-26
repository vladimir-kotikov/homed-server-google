import http from "node:http";
import net from "node:net";
import { UserRepository } from "./db/repository.ts";
import { CapabilityMapper } from "./services/mapper.service.ts";
import { ClientConnection } from "./tcp/client.ts";
import type { GoogleCommand, GoogleDevice } from "./types/googleSmarthome.ts";
import type { DeviceState } from "./types/homed.ts";
import { WebApp } from "./web/app.ts";

// export class GoogleClient {
//   async updateDevices(
//     userId: string | undefined,
//     devices: Array<Record<string, unknown>> | undefined
//   ) {
//     // Implement Google device update logic here
//   }

//   async updateData(userId: string | undefined, data: Record<string, unknown>) {
//     // Implement Google data update logic here
//   }
// }

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

const zip = <T, U>(a: T[], b: U[]): Array<[T, U]> => {
  if (a.length !== b.length) {
    throw new Error("Arrays must be of the same length to zip");
  }
  return a.map((k, index) => [k, b[index]]);
};

export class HomedServerController {
  private httpServer: http.Server;
  private tcpServer: net.Server;
  private userDb: UserRepository;
  private httpHandler: WebApp;
  private mapper: CapabilityMapper;

  // uniqueId to ClientConnection cache
  private clients: Map<string, ClientConnection> = new Map();
  // userId to ClientConnection[] cache
  private userClients: Map<string, ClientConnection[]> = new Map();
  // userId to GoogleDevice[] cache
  private deviceCache: Map<string, GoogleDevice[]> = new Map();
  // deviceId to DeviceState cache
  private stateCache: Map<string, DeviceState> = new Map();

  constructor(userDatabase: UserRepository, httpHandler: WebApp) {
    this.userDb = userDatabase;
    this.httpHandler = httpHandler;
    this.mapper = new CapabilityMapper();

    this.httpServer = http
      .createServer(this.httpHandler.handleRequest)
      .on("error", error => {
        console.error("HTTP Server error:", error);
        this.stop();
      });

    this.tcpServer = net
      .createServer({ keepAlive: true })
      .on("connection", socket => this.clientConnected(socket))
      .on("error", error => {
        console.error("TCP Server error:", error);
        this.stop();
      });
  }

  start(httpPort: number, tcpPort: number) {
    this.httpServer.listen(httpPort);
    this.tcpServer.listen(tcpPort);

    console.log(`HTTP Server listening on port http://0.0.0.0:${httpPort}`);
    console.log(`TCP Server listening on port tcp://0.0.0.0:${tcpPort}`);
  }

  stop() {
    this.userDb.close();
    this.httpServer.close();
    this.tcpServer.close();
  }

  clientConnected(socket: net.Socket) {
    const client = new ClientConnection(socket)
      .on("close", () => this.clientDisconnected(client))
      .on("tokenReceived", token => this.clientTokenReceived(client, token))
      .on("devicesUpdated", devices =>
        this.clientDevicesUpdated(client, devices)
      )
      .on("dataUpdated", data => this.deviceDataUpdated(client, data));

    console.log(`Client connected: ${client.uniqueId}`);
  }

  clientDisconnected(client: ClientConnection) {
    if (client.uniqueId) {
      this.clients.delete(client.uniqueId);
      console.log(`Client disconnected: ${client.uniqueId}`);
    }
  }

  clientTokenReceived(client: ClientConnection, token: string) {
    const uniqueId = client.uniqueId;
    if (!uniqueId) {
      console.warn(`Client has no unique ID, cannot authorize`);
      client.close();
      return;
    }

    this.userDb.getByToken(token).then(user => {
      if (!user) {
        client.close();
        console.warn(`Client ${uniqueId} unauthorized: user not found`);
        return;
      }

      client.authorize();
      this.clients.set(uniqueId, client);
      console.log(`Client ${uniqueId} authorized for ${user.username}`);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async clientDevicesUpdated(_client: ClientConnection, _devices: unknown) {
    // const userId = this.userClient.get(client.uniqueId);
    // this.googleClient.updateDevices(userId, devices);
  }

  async deviceDataUpdated(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _client: ClientConnection,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _data: Record<string, unknown>
  ) {
    // const userId = this.userClient.get(client.uniqueId);
    // this.googleClient.updateData(userId, data);
  }

  /**
   * SYNC intent handler
   *
   * Get Google Smart Home devices for SYNC intent. Relies on cache which is
   * populated/invalidated on TCP device connection and updates from device data.
   */
  getGoogleDevices(userId: string): GoogleDevice[] {
    return this.deviceCache.get(userId) ?? [];
  }

  /**
   * QUERY intent handler
   *
   * Get Google state for devices (QUERY intent) and converts Homed device
   * states to Google format. As opposed to SYNC this is done on-demand as the
   * states change frequently and mapping each change is not efficient.
   */
  getGoogleDeviceStates(
    userId: string,
    deviceIds: string[]
  ): Promise<Record<string, unknown>> {
    const devices = deviceIds.flatMap(
      deviceId =>
        this.deviceCache
          .get(userId)
          ?.filter(device => device.id === deviceId) ?? ([] as GoogleDevice[])
    );

    const states = devices.map(device => this.stateCache.get(device.id) ?? {});

    const deviceStates = Object.fromEntries(
      zip(devices, states).map(([device, state]) => {
        const deviceState = this.mapper.mapToGoogleState(device, state);
        return [device.id, deviceState];
      })
    );

    // TODO: Return empty/error state for devices not found
    return deviceStates;
  }

  /**
   * ACTION intent handler
   *
   * Executes Google command on a Homed device, converts Google command to Homed
   * topic/message
   */
  async executeGoogleCommand(
    userId: string,
    deviceId: string,
    command: GoogleCommand
  ): Promise<{ success: boolean; error?: string }> {
    const device = this.deviceCache.get(userId)?.find(d => d.id === deviceId);
    if (!device) {
      return { success: false, error: "Device not found" };
    }

    const homedCommand = this.mapper.mapToHomedCommand(device, command);
    if (!homedCommand) {
      return {
        success: false,
        error: `Command '${command.command}' not supported for this device`,
      };
    }

    const client = this.userClients
      .get(userId)
      ?.find(client => client.uniqueId === device.clientId);

    if (!client) {
      return { success: false, error: "Device client not connected" };
    }

    client.sendMessage(homedCommand);
    return { success: true };
  }
}
