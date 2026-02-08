import debug from "debug";
import { google, type homegraph_v1 } from "googleapis";
import type { UserId } from "../db/repository.ts";
import type { GoogleDeviceId, GoogleDeviceState } from "./types.ts";

const log = debug("homed:google:homegraph");
const logError = debug("homed:google:homegraph:error");

export class HomeGraphClient {
  private homegraph: homegraph_v1.Homegraph;

  constructor() {
    this.homegraph = google.homegraph("v1");
  }

  reportStateChange = async (
    userId: UserId,
    googleDeviceId: GoogleDeviceId,
    state: GoogleDeviceState
  ): Promise<void> => {
    try {
      await this.homegraph.devices.reportStateAndNotification({
        requestBody: {
          requestId: crypto.randomUUID(),
          agentUserId: userId,
          payload: {
            devices: {
              states: {
                [googleDeviceId]: state,
              },
            },
          },
        },
      });

      log("State reported for device %s", googleDeviceId);
    } catch (error) {
      logError(
        "Failed to report state for device %s: %O",
        googleDeviceId,
        error
      );
      // Don't throw - fire-and-forget pattern
    }
  };

  updateDevices = async (userId: UserId): Promise<void> => {
    try {
      await this.homegraph.devices.requestSync({
        requestBody: {
          agentUserId: userId,
          async: true,
        },
      });

      log("Device update requested for user %s", userId);
    } catch (error) {
      logError("Failed to request device sync for user %s: %O", userId, error);
      // Don't throw - fire-and-forget pattern
    }
  };
}
