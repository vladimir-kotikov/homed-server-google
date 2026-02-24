import { google } from "googleapis";
import { match, P } from "ts-pattern";
import type { User, UserId, UserRepository } from "../db/repository.ts";
import type { DeviceRepository, DeviceStateChangeEvent } from "../device.ts";
import { createLogger } from "../logger.ts";
import { safeParse } from "../utility.ts";
import {
  getStateUpdates,
  mapExecutionRequest,
  mapQueryResponse,
  mapSyncResponse,
} from "./mapper.ts";
import {
  SmartHomeRequestSchema,
  type ExecuteRequestPayload,
  type QueryRequestPayload,
} from "./schema.ts";
import type {
  ExecuteResponseCommand,
  ExecuteResponsePayload,
  QueryResponsePayload,
  SmartHomeResponse,
  SyncResponsePayload,
} from "./types.ts";

const log = createLogger("google:fulfillment");

const debounce = <Args extends unknown[], R>(
  fn: (...args: Args) => R,
  delayMs: number
): ((...args: Args) => void) => {
  let timeoutId: NodeJS.Timeout | undefined;

  return (...args: Args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delayMs);
  };
};

class RequestError extends Error {}

export class FulfillmentController {
  private userRepository: UserRepository;
  private deviceRepository: DeviceRepository;
  private homegraph?: ReturnType<typeof google.homegraph>;

  constructor(
    userRepository: UserRepository,
    deviceRepository: DeviceRepository
  ) {
    this.userRepository = userRepository;
    this.deviceRepository = deviceRepository;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/homegraph"],
      });
      this.homegraph = google.homegraph({
        version: "v1",
        auth,
      });
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Failed to initialize Google Home Graph API client:");
      } else {
        log.warn("homegraph.init", {
          reason:
            "GOOGLE_APPLICATION_CREDENTIALS not set, Home Graph API disabled",
        });
      }
    }

    this.deviceRepository
      // device updates trigger for each device, so debounce
      // to avoid multiple rapid sync requests
      .on("devicesUpdated", debounce(this.requestSync, 300))
      .on("deviceStateChanged", this.handleDeviceStateChanged);
  }

  /**
   * Handle device sync and device capabilities changed events
   * Triggers REQUEST_SYNC to notify Google Home that device traits
   * changed - Google will call back with SYNC intent
   */
  private requestSync = (userId: UserId) =>
    this.homegraph?.devices
      .requestSync({ requestBody: { agentUserId: userId, async: true } })
      .then(() => log.debug("homegraph.request_sync"))
      .catch(error => log.error("homegraph.request_sync", error));

  /**
   * Handle device state change events from repository
   * Maps state to Google format and reports to Home Graph API
   */
  private handleDeviceStateChanged = async ({
    userId,
    clientId,
    device,
    prevState,
    newState,
  }: DeviceStateChangeEvent) => {
    const states = getStateUpdates(device, clientId, prevState, newState);
    if (!states) {
      return;
    }

    log.debug("homegraph.report_state", {
      devices: Object.keys(states).length,
    });

    return this.homegraph?.devices
      .reportStateAndNotification({
        requestBody: {
          requestId: crypto.randomUUID(),
          agentUserId: userId,
          payload: { devices: { states } },
        },
      })
      .catch(error => {
        // 404 means the agent user entity no longer exists in Home Graph
        // (e.g. user unlinked the account). Re-register by sending REQUEST_SYNC,
        // which will prompt Google to call back with a SYNC intent and recreate
        // the entity.
        if ((error as { status?: number })?.status === 404) {
          log.warn("homegraph.report_state.entity_not_found", {
            reason: "triggering request_sync to re-register agent user",
          });
          return this.requestSync(userId);
        }
        log.error("homegraph.report_state", error);
      });
  };

  handleFulfillment = async (
    user: User,
    requestData: unknown
  ): Promise<SmartHomeResponse> =>
    safeParse(requestData, SmartHomeRequestSchema)
      .toPromise()
      .then(
        ({ requestId, inputs: [input] }) =>
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
          log.error("fulfillment.error", error, { reason: "invalid_request" });
          throw new RequestError("Invalid Smart Home request");
        }
      );

  private handleSync = async (user: User): Promise<SyncResponsePayload> => {
    const devicesWithStates = this.deviceRepository
      .getDevicesWithState(user.id)
      .filter(({ device }) => device.endpoints.length > 0);

    const response = mapSyncResponse(user.id, devicesWithStates);

    log.debug("fulfillment.response_sync", {
      devices: response.devices.length,
    });

    return response;
  };

  private handleQuery = async (
    request: QueryRequestPayload,
    user: User
  ): Promise<QueryResponsePayload> =>
    mapQueryResponse(
      new Set(request.devices.map(d => d.id)),
      this.deviceRepository.getDevicesWithState(user.id)
    );

  private handleExecute = async (
    request: ExecuteRequestPayload,
    user: User
  ): Promise<ExecuteResponsePayload> => {
    const commandResults: ExecuteResponseCommand[] = [];
    const allDevices = this.deviceRepository.getDevices(user.id);

    for (const { devices, execution } of request.commands) {
      const commandsToSend = mapExecutionRequest(
        {
          userId: user.id,
          googleDeviceIds: devices.map(d => d.id),
          commands: execution,
        },
        allDevices
      );

      for (const {
        userId,
        clientId,
        deviceId,
        endpointId,
        googleDeviceIds,
        message,
      } of commandsToSend) {
        log.debug("fulfillment.request_execute", {
          deviceId,
          endpointId,
          action: message.action,
        });

        const executed = this.deviceRepository.executeCommand(
          userId,
          clientId,
          deviceId,
          endpointId,
          message
        );

        commandResults.push({
          ids: googleDeviceIds,
          status: executed ? "SUCCESS" : "OFFLINE",
          ...(executed ? {} : { errorCode: "deviceOffline" }),
        });
      }
    }

    return { commands: commandResults };
  };

  private handleDisconnect = (user: User) =>
    this.userRepository
      .delete(user.id)
      .then(() => this.deviceRepository.removeClientDevices(user.id))
      .then(() => ({}));
}
