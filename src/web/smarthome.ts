import type { Response } from "express";
import { Router } from "express";
import passport from "passport";
import { match } from "ts-pattern";
import type { UserRepository } from "../db/repository.ts";
import {
  SmartHomeRequestSchema,
  type DisconnectRequest,
  type ExecuteRequest,
  type QueryRequest,
  type SmartHomeRequest,
  type SyncRequest,
} from "../schemas/googleSmarthome.schema.ts";
import { DeviceService } from "../services/device.service.ts";
import type { HomedDevice } from "../services/mapper.service.ts";
import type {
  DisconnectResponse,
  ExecuteResponse,
  QueryResponse,
  SmartHomeResponse,
  SyncResponse,
} from "../types/googleSmarthome.ts";
import type { DeviceState } from "../types/homed.ts";
import { requireLoggedIn } from "./authStrategies.ts";

export class SmartHomeController {
  private deviceService: DeviceService;
  private userRepository: UserRepository;

  constructor(userRepository: UserRepository, deviceService: DeviceService) {
    this.userRepository = userRepository;
    this.deviceService = deviceService;
  }

  /**
   * POST /fulfillment
   * Main handler for all Google Smart Home intents
   */
  handleFulfillment = async (
    request: Request,
    response: Response
  ): Promise<void> => {
    const parseResult = SmartHomeRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      response.status(400).json({
        error: "Invalid request format",
        details: { root: parseResult.error.message },
      });
      return;
    }

    const smarthomeRequest: SmartHomeRequest = parseResult.data;

    try {
      const userId = request.user.userId;
      if (!userId) {
        response.status(401).json({
          error: "Unauthorized",
          details: { root: "Missing userId in request" },
        });
        return;
      }

      const smarthomeResponse: SmartHomeResponse = await match(smarthomeRequest)
        .with(
          { inputs: [{ intent: "action.devices.SYNC" }] },
          smarthomeRequest => this.handleSync(smarthomeRequest, userId)
        )
        .with(
          { inputs: [{ intent: "action.devices.QUERY" }] },
          smarthomeRequest => this.handleQuery(smarthomeRequest, userId)
        )
        .with(
          { inputs: [{ intent: "action.devices.EXECUTE" }] },
          smarthomeRequest => this.handleExecute(smarthomeRequest, userId)
        )
        .with(
          { inputs: [{ intent: "action.devices.DISCONNECT" }] },
          smarthomeRequest => this.handleDisconnect(smarthomeRequest, userId)
        )
        .exhaustive();

      response.json(smarthomeResponse);
    } catch (error) {
      console.error("Fulfillment error:", error);
      response.status(500).json({
        requestId: smarthomeRequest.requestId,
        payload: {
          errorCode: "hardError",
          debugString: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  };

  /**
   * Handle SYNC intent - return all user's devices
   */
  private async handleSync(
    request: SyncRequest,
    userId: string
  ): Promise<SyncResponse> {
    const googleDevices = await this.deviceService.getGoogleDevices(userId);

    return {
      requestId: request.requestId,
      payload: {
        agentUserId: userId,
        devices: googleDevices,
      },
    };
  }

  /**
   * Handle QUERY intent - return device states
   */
  private async handleQuery(
    request: QueryRequest,
    userId: string
  ): Promise<QueryResponse> {
    const googleDeviceIds = request.inputs[0].payload.devices.map(
      (d: { id: string }) => d.id
    );

    // Get all devices to build device map
    const homedDevices = await this.deviceService.getAllDevices(userId);
    const deviceMap = new Map<string, HomedDevice>();

    for (const device of homedDevices) {
      if (device.key) {
        deviceMap.set(device.key, device);
      }
    }

    // Get device states for all devices
    const states = await this.deviceService.queryDeviceStates(userId, [
      ...deviceMap.keys(),
    ]);

    // Build device states response using properly typed structure
    const devices: QueryResponse["payload"]["devices"] = {};

    for (const googleDeviceId of googleDeviceIds) {
      // Extract device key from Google ID (format: clientId-deviceKey)
      const parts = googleDeviceId.split("-");
      const deviceKey = parts.slice(1).join("-");

      const homedDevice = deviceMap.get(deviceKey);
      if (!homedDevice) {
        devices[googleDeviceId] = {
          online: false,
          status: "OFFLINE",
        };
        continue;
      }

      const deviceState: DeviceState = states.get(deviceKey) ?? {};
      devices[googleDeviceId] = this.deviceService.getGoogleDeviceState(
        homedDevice,
        deviceState
      );
    }

    return {
      requestId: request.requestId,
      payload: {
        devices,
      },
    };
  }

  /**
   * Handle EXECUTE intent - execute commands on devices
   */
  private async handleExecute(
    request: ExecuteRequest,
    userId: string
  ): Promise<ExecuteResponse> {
    const commands = request.inputs[0].payload.commands;
    const commandResults: Array<{
      ids: string[];
      status: "SUCCESS" | "PENDING" | "OFFLINE" | "ERROR";
      errorCode?: string;
      debugString?: string;
    }> = [];

    // Get all devices for mapping
    const homedDevices = await this.deviceService.getAllDevices(userId);
    const deviceMap = new Map<string, HomedDevice>();

    for (const device of homedDevices) {
      if (device.key) {
        deviceMap.set(device.key, device);
      }
    }

    for (const command of commands) {
      const googleDeviceIds = command.devices.map((d: { id: string }) => d.id);
      const execution = command.execution[0]; // Take first execution

      for (const googleDeviceId of googleDeviceIds) {
        try {
          // Extract device key from Google ID (format: clientId-deviceKey)
          const parts = googleDeviceId.split("-");
          const deviceKey = parts.slice(1).join("-");

          const homedDevice = deviceMap.get(deviceKey);
          if (!homedDevice) {
            commandResults.push({
              ids: [googleDeviceId],
              status: "ERROR",
              errorCode: "deviceNotFound",
            });
            continue;
          }

          // Execute command using mapper
          const result = await this.deviceService.executeGoogleCommand(
            userId,
            homedDevice,
            execution
          );

          if (result.success) {
            commandResults.push({
              ids: [googleDeviceId],
              status: "SUCCESS",
            });
          } else {
            commandResults.push({
              ids: [googleDeviceId],
              status: "ERROR",
              errorCode: result.error?.includes("No connected")
                ? "deviceOffline"
                : "hardError",
            });
          }
        } catch (error) {
          commandResults.push({
            ids: [googleDeviceId],
            status: "ERROR",
            errorCode: "hardError",
            debugString:
              error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    return {
      requestId: request.requestId,
      payload: {
        commands: commandResults,
      },
    };
  }

  /**
   * Handle DISCONNECT intent - revoke user's tokens
   */
  private async handleDisconnect(
    request: DisconnectRequest,
    userId: string
  ): Promise<DisconnectResponse> {
    // Revoke all refresh tokens for the user
    await this.userRepository.revokeTokens(userId);

    return {
      requestId: request.requestId,
      payload: {},
    };
  }

  get routes() {
    return (
      Router()
        // POST /fulfillment - handle Smart Home fulfillment
        .post(
          "/fulfillment",
          passport.authenticate("jwt", { session: false }),
          requireLoggedIn,
          this.handleFulfillment
        )
    );
  }
}
