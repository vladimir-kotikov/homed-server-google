import debug from "debug";
import { google, type homegraph_v1 } from "googleapis";
import type { UserId } from "../db/repository.ts";
import type { GoogleDeviceId, GoogleDeviceState } from "./types.ts";

const log = debug("homed:google:homegraph");
const logError = debug("homed:google:homegraph:error");

export class HomeGraphClient {
  private homegraph: homegraph_v1.Homegraph;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/homegraph"],
    });
    this.homegraph = google.homegraph({
      version: "v1",
      auth,
    });
  }

  reportStateChange = async (
    userId: UserId,
    stateUpdates: Array<{
      googleDeviceId: GoogleDeviceId;
      state: GoogleDeviceState;
    }>
  ): Promise<void> => {
    if (stateUpdates.length === 0) return;

    // Build states object with all device states
    const states: Record<string, GoogleDeviceState> = {};
    for (const { googleDeviceId, state } of stateUpdates) {
      states[googleDeviceId] = state;
    }

    await this.homegraph.devices.reportStateAndNotification({
      requestBody: {
        requestId: crypto.randomUUID(),
        agentUserId: userId,
        payload: {
          devices: {
            states,
          },
        },
      },
    });
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
