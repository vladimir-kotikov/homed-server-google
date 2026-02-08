import debug from "debug";
import { match, P } from "ts-pattern";
import type { User, UserRepository } from "../db/repository.ts";
import type { DeviceId, DeviceRepository } from "../device.ts";
import { safeParse } from "../utility.ts";
import {
  mapToGoogleDevice,
  mapToGoogleState,
  mapToHomedCommand,
} from "./mapper.ts";
import {
  SmartHomeRequestSchema,
  type ExecuteRequestPayload,
  type QueryRequestPayload,
} from "./schema.ts";
import type {
  ExecuteResponsePayload,
  QueryResponsePayload,
  SmartHomeResponse,
  SyncResponsePayload,
} from "./types.ts";

const logError = debug("homed:google:fulfillment:error");

class RequestError extends Error {}

export class FulfillmentController {
  private userRepository: UserRepository;
  private deviceRepository: DeviceRepository;

  constructor(
    userRepository: UserRepository,
    deviceRepository: DeviceRepository
  ) {
    this.userRepository = userRepository;
    this.deviceRepository = deviceRepository;
  }

  handleFulfillment = async (
    user: User,
    requestData: unknown
  ): Promise<SmartHomeResponse> =>
    safeParse(requestData, SmartHomeRequestSchema)
      .toPromise()
      .then(
        async ({ requestId, inputs: [input] }) =>
          match(input)
            .with({ intent: "action.devices.SYNC" }, () =>
              this.handleSync(user)
            )
            .with({ intent: "action.devices.QUERY", payload: P.select() }, p =>
              this.handleQuery(p, user)
            )
            .with(
              { intent: "action.devices.EXECUTE", payload: P.select() },
              p => this.handleExecute(p, user)
            )
            .with({ intent: "action.devices.DISCONNECT" }, () =>
              this.handleDisconnect(user)
            )
            .exhaustive()
            .then(payload => ({ requestId, payload })),
        error => {
          logError("Invalid Smart Home request:", error);
          throw new RequestError("Invalid Smart Home request");
        }
      );

  private handleSync = async (user: User): Promise<SyncResponsePayload> => ({
    agentUserId: user.id,
    devices: this.deviceRepository
      .getDevices(user.id)
      .filter(device => device.endpoints.length > 0)
      .map(device => mapToGoogleDevice(device, user.clientToken)),
  });

  private handleQuery = async (
    request: QueryRequestPayload,
    user: User
  ): Promise<QueryResponsePayload> => {
    const requestedDeviceIds = new Set(request.devices.map(d => d.id));

    const mappedStates = this.deviceRepository
      .getDevices(user.id)
      .filter(device => requestedDeviceIds.has(device.key))
      .map(
        device =>
          [
            device,
            this.deviceRepository.getDeviceState(
              user.id,
              device.key as DeviceId
            ),
          ] as const
      )
      .map(
        ([device, state]) =>
          [device.key, mapToGoogleState(device, state ?? {})] as const
      );

    return { devices: Object.fromEntries(mappedStates) };
  };

  private handleExecute = async (
    request: ExecuteRequestPayload,
    user: User
  ): Promise<ExecuteResponsePayload> => {
    const homedCommands = request.commands.flatMap(({ devices, execution }) => {
      const requestedDeviceIds = new Set(devices.map(d => d.id));
      return this.deviceRepository
        .getDevices(user.id)
        .filter(device => requestedDeviceIds.has(device.key))
        .flatMap(device =>
          execution.map(command => mapToHomedCommand(device, command))
        );
    });

    console.log("Homed commands to execute:", homedCommands);
    // FIXME: implement proper command result handling
    return { commands: [] };
  };

  private handleDisconnect = (user: User) =>
    this.userRepository
      .delete(user.id)
      .then(() => this.deviceRepository.removeDevices(user.id))
      .then(() => ({}));
}
