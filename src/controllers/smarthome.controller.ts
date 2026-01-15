import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { DeviceService } from "../services/device.service";
import { TokenService } from "../services/token.service";
import {
  DisconnectRequest,
  DisconnectResponse,
  ExecuteRequest,
  ExecuteResponse,
  GoogleDevice,
  QueryRequest,
  QueryResponse,
  SmartHomeRequest,
  SmartHomeResponse,
  SyncRequest,
  SyncResponse,
} from "../types";

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
    const devices = await this.deviceService.getAllDevices(userId);

    // Convert Homed devices to Google Smart Home devices
    const googleDevices: GoogleDevice[] = devices.map(device => {
      // TODO: Implement proper device mapping in Step 4
      // For now, return basic structure
      return {
        id: device.id || device.key || "unknown",
        type: "action.devices.types.OUTLET", // Placeholder
        traits: ["action.devices.traits.OnOff"], // Placeholder
        name: {
          defaultNames: [device.name || "Unknown Device"],
          name: device.name || "Unknown Device",
          nicknames: [device.name || "Unknown Device"],
        },
        willReportState: false,
        deviceInfo: {
          manufacturer: "Homed",
          model: device.model || "unknown",
          hwVersion: "1.0",
          swVersion: "1.0",
        },
      };
    });

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
    const deviceIds = request.inputs[0].payload.devices.map(d => d.id);
    const states = await this.deviceService.queryDeviceStates(
      userId,
      deviceIds
    );

    // Build device states response
    const devices: Record<string, any> = {};

    for (const deviceId of deviceIds) {
      const state = states.get(deviceId);

      if (state) {
        // TODO: Implement proper state mapping in Step 4
        // For now, return basic online state
        devices[deviceId] = {
          online: true,
          status: "SUCCESS",
          ...state, // Include raw state for now
        };
      } else {
        devices[deviceId] = {
          online: false,
          status: "OFFLINE",
        };
      }
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
    const commandResults: any[] = [];

    for (const command of commands) {
      const deviceIds = command.devices.map(d => d.id);
      const execution = command.execution[0]; // Take first execution

      for (const deviceId of deviceIds) {
        try {
          // TODO: Implement proper command mapping in Step 4
          // For now, send raw command
          const result = await this.deviceService.executeCommand(
            userId,
            deviceId,
            {
              topic: `td/${deviceId}`, // to-device topic
              message: {
                command: execution.command,
                params: execution.params,
              },
            }
          );

          if (result.success) {
            commandResults.push({
              ids: [deviceId],
              status: "SUCCESS",
              states: {
                online: true,
                ...execution.params, // Return command params as new state
              },
            });
          } else {
            commandResults.push({
              ids: [deviceId],
              status: "ERROR",
              errorCode: "deviceOffline",
            });
          }
        } catch (error) {
          commandResults.push({
            ids: [deviceId],
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
