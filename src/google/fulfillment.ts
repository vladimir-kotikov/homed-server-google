import debug from "debug";
import { match, P } from "ts-pattern";
import type { User, UserRepository } from "../db/repository.ts";
import type { DeviceId, DeviceRepository } from "../device.ts";
import { safeParse } from "../utility.ts";
import {
  getEndpointIdFromGoogleDeviceId,
  getGoogleDeviceIds,
  mapToGoogleDevices,
  mapToGoogleStateReports,
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
const log = debug("homed:google:fulfillment");

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
              this.handleQuery(p as QueryRequestPayload, user)
            )
            .with(
              { intent: "action.devices.EXECUTE", payload: P.select() },
              p => this.handleExecute(p as ExecuteRequestPayload, user)
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

  private handleSync = async (user: User): Promise<SyncResponsePayload> => {
    const allDevices = this.deviceRepository
      .getDevices(user.id)
      .filter(({ device }) => device.endpoints.length > 0);

    const googleDevices = allDevices
      .flatMap(({ device, clientId }) => {
        const allExposes = device.endpoints
          .flatMap(ep => ep.exposes)
          .filter((e, i, a) => a.indexOf(e) === i);
        log(
          `Homed device: name="${device.name}", exposes=${JSON.stringify(allExposes)}, manufacturer="${device.manufacturer}", model="${device.model}"`
        );
        return mapToGoogleDevices(device, clientId);
      })
      .filter(device => {
        const hasTraits = device.traits.length > 0;
        if (!hasTraits) {
          log(
            `Excluding device "${device.name.name}" (${device.id}): no supported traits`
          );
        } else {
          log(
            `Google device: id="${device.id}", type="${device.type}", traits=${JSON.stringify(device.traits)}, name.name="${device.name.name}"`
          );
        }
        return hasTraits;
      });

    log(
      `Syncing ${googleDevices.length} Google devices from ${allDevices.length} Homed devices`
    );

    return {
      agentUserId: user.id,
      devices: googleDevices,
    };
  };

  private handleQuery = async (
    request: QueryRequestPayload,
    user: User
  ): Promise<QueryResponsePayload> => {
    const requestedDeviceIds = new Set(request.devices.map(d => d.id));

    const mappedStates = this.deviceRepository
      .getDevices(user.id)
      .flatMap(({ device, clientId }) => {
        const state = this.deviceRepository.getDeviceState(
          user.id,
          device.key as DeviceId,
          clientId
        );

        // Use mapper to get all Google device IDs and states for this Homed device
        const stateReports = mapToGoogleStateReports(
          device,
          clientId,
          device.key as DeviceId,
          state ?? {}
        );

        // Filter to only requested device IDs
        return stateReports
          .filter(({ googleDeviceId }) =>
            requestedDeviceIds.has(googleDeviceId)
          )
          .map(
            ({ googleDeviceId, googleState }) =>
              [googleDeviceId, googleState] as const
          );
      });

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
        .flatMap(({ device, clientId }) => {
          // Get all Google device IDs that exist for this Homed device
          const googleDeviceIds = getGoogleDeviceIds(device, clientId);

          return googleDeviceIds
            .filter(googleId => requestedDeviceIds.has(googleId))
            .map(googleId => ({
              device,
              googleId,
              endpointId: getEndpointIdFromGoogleDeviceId(googleId),
            }));
        })
        .flatMap(({ device, endpointId }) => {
          // For multi-endpoint devices, filter to only the requested endpoint
          const deviceForCommand =
            endpointId !== undefined
              ? {
                  ...device,
                  endpoints: device.endpoints.filter(
                    ep => ep.id === endpointId
                  ),
                }
              : device;

          return execution.map(command =>
            mapToHomedCommand(deviceForCommand, command)
          );
        });
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
