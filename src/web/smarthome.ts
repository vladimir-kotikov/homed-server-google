import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
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

/**
 * Extend Express Request type to include user info
 */
export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export class SmartHomeController {
  private deviceService: DeviceService;
  private userRepository: UserRepository;
  private verifyAccessToken: (token: string) => { userId: string } | undefined;

  constructor(
    userRepository: UserRepository,
    verifyAccessToken: (token: string) => { userId: string } | undefined,
    deviceService: DeviceService
  ) {
    this.verifyAccessToken = verifyAccessToken;
    this.deviceService = deviceService;
    this.userRepository = userRepository;
  }

  /**
   * POST /fulfillment
   * Main handler for all Google Smart Home intents
   */
  async handleFulfillment(
    request_: AuthenticatedRequest,
    response: Response
  ): Promise<void> {
    const parseResult = SmartHomeRequestSchema.safeParse(request_.body);

    if (!parseResult.success) {
      response.status(400).json({
        error: "Invalid request format",
        details: { root: parseResult.error.message },
      });
      return;
    }

    const request: SmartHomeRequest = parseResult.data;

    try {
      const userId = request_.userId;
      if (!userId) {
        response.status(401).json({
          error: "Unauthorized",
          details: { root: "Missing userId in request" },
        });
        return;
      }

      const smarthomeResponse: SmartHomeResponse = await match(request)
        .with({ inputs: [{ intent: "action.devices.SYNC" }] }, request =>
          this.handleSync(request, userId)
        )
        .with({ inputs: [{ intent: "action.devices.QUERY" }] }, request =>
          this.handleQuery(request, userId)
        )
        .with({ inputs: [{ intent: "action.devices.EXECUTE" }] }, request =>
          this.handleExecute(request, userId)
        )
        .with({ inputs: [{ intent: "action.devices.DISCONNECT" }] }, request =>
          this.handleDisconnect(request, userId)
        )
        .exhaustive();

      response.json(smarthomeResponse);
    } catch (error) {
      console.error("Fulfillment error:", error);
      response.status(500).json({
        requestId: request.requestId,
        payload: {
          errorCode: "hardError",
          debugString: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }

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

  /**
   * Middleware to authenticate JWT access token from Authorization header
   */
  private authenticateToken = (
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction
  ): void => {
    const authHeader = request.headers.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;

    if (!token) {
      response.status(401).json({
        error: "unauthorized",
        error_description: "No token provided",
      });
      return;
    }

    const payload = this.verifyAccessToken(token);

    if (!payload) {
      response.status(401).json({
        error: "invalid_token",
        error_description: "Token is invalid or expired",
      });
      return;
    }

    request.userId = payload.userId;
    next();
  };

  get routes() {
    return (
      Router()
        // POST /fulfillment - Main Smart Home fulfillment endpoint
        .post("/fulfillment", this.authenticateToken, (request, response) => {
          this.handleFulfillment(request, response);
        })
    );
  }
}
