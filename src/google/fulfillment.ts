import * as Sentry from "@sentry/node";
import debug from "debug";
import { google } from "googleapis";
import { match, P } from "ts-pattern";
import type { User, UserId, UserRepository } from "../db/repository.ts";
import type {
  DeviceId,
  DeviceRepository,
  DeviceStateChangeEvent,
} from "../device.ts";
import { fastDeepEqual, safeParse } from "../utility.ts";
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
  GoogleDeviceId,
  GoogleDeviceState,
  QueryResponsePayload,
  SmartHomeResponse,
  SyncResponsePayload,
} from "./types.ts";

const logDebug = debug("homed:google:fulfillment:debug");
const logError = debug("homed:google:fulfillment:error");
const log = debug("homed:google:fulfillment");

class RequestError extends Error {}

export class FulfillmentController {
  private userRepository: UserRepository;
  private deviceRepository: DeviceRepository;
  private homegraph: ReturnType<typeof google.homegraph>;

  constructor(
    userRepository: UserRepository,
    deviceRepository: DeviceRepository
  ) {
    this.userRepository = userRepository;
    this.deviceRepository = deviceRepository;
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/homegraph"],
    });
    this.homegraph = google.homegraph({
      version: "v1",
      auth,
    });

    this.deviceRepository
      .on("devicesUpdated", this.requestSync)
      .on("deviceStateChanged", this.handleDeviceStateChanged);
  }

  /**
   * Handle device sync and device capabilities changed events
   * Triggers REQUEST_SYNC to notify Google Home that device traits
   * changed - Google will call back with SYNC intent
   */
  private requestSync = (userId: UserId) =>
    this.homegraph.devices
      .requestSync({ requestBody: { agentUserId: userId, async: true } })
      .then(() => log("Device update requested for user %s", userId))
      .catch(error => {
        logError(
          "Failed to request device sync for user %s: %O",
          userId,
          error
        );
        Sentry.captureException(error);
      });

  /**
   * Handle device state change events from repository
   * Maps state to Google format and reports to Home Graph API
   */
  private handleDeviceStateChanged = async ({
    userId,
    clientId,
    deviceId,
    device,
    prevState,
    newState,
  }: DeviceStateChangeEvent) => {
    if (!device.endpoints.some(ep => ep.exposes && ep.exposes.length > 0)) {
      logDebug(`Skipping Google state report: device has no supported traits`);
      return;
    }

    const prevStates = mapToGoogleStateReports(
      device,
      clientId,
      deviceId,
      prevState
    ).reduce(
      (states, { googleDeviceId, googleState }) => {
        states[googleDeviceId] = googleState;
        return states;
      },
      {} as Record<GoogleDeviceId, GoogleDeviceState>
    );

    const newStates = mapToGoogleStateReports(
      device,
      clientId,
      deviceId,
      newState
    ).reduce(
      (states, { googleDeviceId, googleState }) => {
        states[googleDeviceId] = googleState;
        return states;
      },
      {} as Record<GoogleDeviceId, GoogleDeviceState>
    );

    // Only report state changes to Google if there are actual differences in the reported state
    const stateUpdates = Object.fromEntries(
      Object.entries(newStates).filter(([googleDeviceId, newState]) => {
        const prevState = prevStates[googleDeviceId as GoogleDeviceId];
        const hasChanged = !fastDeepEqual(prevState, newState);
        if (!hasChanged) {
          logDebug(
            `Skipping Google state report for device ${googleDeviceId}: no state change detected`
          );
        }
        return hasChanged;
      })
    );

    if (Object.keys(stateUpdates).length === 0) {
      logDebug(`Skipping Google state report: no state reports generated`);
      return;
    }

    log(
      `Reporting state to Google for ${Object.keys(stateUpdates).length} device(s): ${JSON.stringify(stateUpdates)}`
    );

    return this.homegraph.devices
      .reportStateAndNotification({
        requestBody: {
          requestId: crypto.randomUUID(),
          agentUserId: userId,
          payload: { devices: { states: stateUpdates } },
        },
      })
      .catch(error => {
        logError("Failed to report state change: %O", error);
        Sentry.captureException(error);
      });
  };

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
      .then(() => this.deviceRepository.removeClientDevices(user.id))
      .then(() => ({}));
}
