import debug from "debug";
import { google, type Auth } from "googleapis";
import type { UserId } from "../db/repository.ts";
import type { HomedDevice } from "../device.ts";
import type { GoogleDeviceState } from "./types.ts";

const log = debug("homed:google:homegraph");

const DEBOUNCE_DELAY_MS = 1000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

interface PendingStateReport {
  userId: UserId;
  deviceId: string;
  state: GoogleDeviceState;
  timeout: NodeJS.Timeout;
}

export class HomeGraphClient {
  private authClient:
    | Auth.GoogleAuth
    | Auth.OAuth2Client
    | Auth.BaseExternalAccountClient
    | undefined = undefined;
  private projectId: string | undefined = undefined;
  private pendingReports = new Map<string, PendingStateReport>();

  constructor(serviceAccountJson?: string) {
    if (serviceAccountJson) {
      this.initializeAuth(serviceAccountJson);
    }
  }

  private async initializeAuth(serviceAccountJson: string): Promise<void> {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      const auth = await google.auth.fromJSON(serviceAccount);
      this.authClient = auth as
        | Auth.GoogleAuth
        | Auth.OAuth2Client
        | Auth.BaseExternalAccountClient;
      this.projectId = serviceAccount.project_id;
      log("Authenticated with service account for project: %s", this.projectId);
    } catch (error) {
      log("Failed to initialize authentication: %O", error);
    }
  }

  async reportStateChange(
    userId: UserId,
    deviceId: string,
    state: GoogleDeviceState
  ): Promise<void> {
    // Skip if not initialized
    if (!this.authClient || !this.projectId) {
      log("Skipping state report - not initialized");
      return;
    }

    // Filter out devices without traits (only online/status are not trait states)
    const traitState = Object.keys(state).filter(
      key => key !== "online" && key !== "status"
    );
    if (traitState.length === 0) {
      log("Skipping state report - no trait states for device %s", deviceId);
      return;
    }

    // Debounce: cancel existing pending report for this device
    const reportKey = `${userId}-${deviceId}`;
    const existing = this.pendingReports.get(reportKey);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    // Schedule debounced report
    const timeout = setTimeout(() => {
      this.pendingReports.delete(reportKey);
      this.executeStateReport(userId, deviceId, state, 0);
    }, DEBOUNCE_DELAY_MS);

    this.pendingReports.set(reportKey, {
      userId,
      deviceId,
      state,
      timeout,
    });
  }

  private async executeStateReport(
    userId: UserId,
    deviceId: string,
    state: GoogleDeviceState,
    attempt: number
  ): Promise<void> {
    try {
      const homegraph = google.homegraph({
        version: "v1",
        auth: this.authClient,
      });

      const fullDeviceId = `${userId}-${deviceId}`;
      const requestId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

      await homegraph.devices.reportStateAndNotification({
        requestBody: {
          agentUserId: userId,
          requestId,
          payload: {
            devices: {
              states: {
                [fullDeviceId]: state,
              },
            },
          },
        },
      });

      log("State reported for device %s", fullDeviceId);
    } catch (error) {
      // Fire-and-forget pattern with retry: log but don't throw
      log(
        "Failed to report state for device %s (attempt %d): %O",
        deviceId,
        attempt + 1,
        error
      );

      // Retry with exponential backoff
      if (attempt < MAX_RETRIES) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        log(
          "Retrying state report for device %s in %dms (attempt %d/%d)",
          deviceId,
          delayMs,
          attempt + 2,
          MAX_RETRIES + 1
        );

        setTimeout(() => {
          this.executeStateReport(userId, deviceId, state, attempt + 1);
        }, delayMs);
      } else {
        log(
          "Giving up on state report for device %s after %d attempts",
          deviceId,
          MAX_RETRIES + 1
        );
      }
    }
  }

  updateDevices = async (_userId: string, _endpoints: HomedDevice[]) => {};
}
