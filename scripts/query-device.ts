#!/usr/bin/env node
/**
 * Query device information from Google Home Graph API
 * Usage: tsx scripts/query-device.ts <userId> <clientId> <deviceKey>
 */

import { google } from "googleapis";

const deviceKey = process.argv[2];
const userId = process.argv[3] ?? process.env.HOMED_USER_ID;
const clientId = process.argv[4] ?? process.env.HOMED_CLIENT_ID;

if (!userId || !clientId || !deviceKey) {
  console.error(
    "Usage: tsx scripts/query-device.ts <userId> <clientId> <deviceKey>"
  );
  console.error("\nExamples:");
  console.error(
    "  tsx scripts/query-device.ts user_35917c3a30 test-client zigbee/84:fd:27:ff:fe:75:bf:44"
  );
  console.error(
    "  tsx scripts/query-device.ts user_35917c3a30 test-client 0x00124b0024c4f355"
  );
  console.error(
    "\nNote: The script will construct Google device ID as <clientId>/<deviceKey>"
  );
  process.exit(1);
}

// Construct Google device ID from clientId and deviceKey
const googleDeviceId = `${clientId}/${deviceKey}`;

// Initialize Home Graph client
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/homegraph"],
});
const homegraph = google.homegraph({
  version: "v1",
  auth,
});

// Query device from Google
console.log(`Querying device ${googleDeviceId} for user ${userId}...\n`);

try {
  const response = await homegraph.devices.query({
    requestBody: {
      requestId: crypto.randomUUID(),
      agentUserId: userId,
      inputs: [
        {
          payload: {
            devices: [{ id: googleDeviceId }],
          },
        },
      ],
    },
  });

  console.log("=== GOOGLE HOME GRAPH RESPONSE ===");
  console.log(JSON.stringify(response.data, null, 2));

  const payload = response.data.payload as any;
  if (payload?.devices?.[googleDeviceId]) {
    const deviceState = payload.devices[googleDeviceId];
    console.log("\n=== DEVICE STATE SUMMARY ===");
    console.log(`Online: ${deviceState.online}`);
    console.log(`Status: ${deviceState.status || "SUCCESS"}`);

    // Show state properties
    const stateProps = Object.keys(deviceState).filter(
      k => k !== "online" && k !== "status"
    );
    if (stateProps.length > 0) {
      console.log("\nState Properties:");
      stateProps.forEach(prop => {
        console.log(`  ${prop}: ${JSON.stringify(deviceState[prop])}`);
      });
    }
  }
} catch (error: any) {
  console.log("=== GOOGLE HOME GRAPH ERROR ===");
  console.log(error?.message || String(error));
  if (error?.code === 404) {
    console.log("\n⚠️  Device not found in Google Home Graph!");
    console.log(
      "This means the device was never synced or was synced with a different ID."
    );
  }
}
