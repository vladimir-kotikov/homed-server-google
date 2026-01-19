import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.ts";
import { DeviceService } from "../services/device.service.ts";
import type { HomedDevice } from "../services/mapper.service.ts";
import { TokenService } from "../services/token.service.ts";
import type {
  DisconnectRequest,
  DisconnectResponse,
  ExecuteRequest,
  ExecuteResponse,
  QueryRequest,
  QueryResponse,
  SmartHomeRequest,
  SmartHomeResponse,
  SyncRequest,
  SyncResponse,
} from "../types.ts";

export class SmartHomeController {
  private deviceService: DeviceService;
  private tokenService: TokenService;

  constructor(deviceService: DeviceService, tokenService: TokenService) {
    this.deviceService = deviceService;
    this.tokenService = tokenService;
  }

  /**
   * POST /fulfillment
   * Main handler for all Google Smart Home intents
   */
  async handleFulfillment(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    const request = req.body as SmartHomeRequest;

    if (!request.requestId || !request.inputs) {
      res.status(400).json({ error: "Invalid request format" });
      return;
    }

    const input = request.inputs[0];
    const intent = input.intent;

    try {
      let response: SmartHomeResponse;

      switch (intent) {
        case "action.devices.SYNC":
          response = await this.handleSync(request as SyncRequest, req.userId!);
          break;
        case "action.devices.QUERY":
          response = await this.handleQuery(
            request as QueryRequest,
            req.userId!
          );
          break;
        case "action.devices.EXECUTE":
          response = await this.handleExecute(
            request as ExecuteRequest,
            req.userId!
          );
          break;
        case "action.devices.DISCONNECT":
          response = await this.handleDisconnect(
            request as DisconnectRequest,
            req.userId!
          );
          break;
        default:
          res.status(400).json({ error: `Unknown intent: ${intent}` });
          return;
      }

      res.json(response);
    } catch (error) {
      console.error("Fulfillment error:", error);
      res.status(500).json({
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
    const states = await this.deviceService.queryDeviceStates(
      userId,
      Array.from(deviceMap.keys())
    );

    // Build device states response
    const devices: Record<string, any> = {};

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

      const deviceState = states.get(deviceKey);
      devices[googleDeviceId] = this.deviceService.getGoogleDeviceState(
        homedDevice,
        deviceState || {}
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
    await this.tokenService.revokeAllUserTokens(userId);

    return {
      requestId: request.requestId,
      payload: {},
    };
  }
}
