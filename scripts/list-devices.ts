#!/usr/bin/env node
/**
 * List all devices synced to Google Home Graph API
 * Usage: npx tsx scripts/list-devices.ts <userId> [clientId]
 */

import { google } from "googleapis";

const userId = process.argv[2] ?? process.env.HOMED_USER_ID;
const clientIdFilter = process.argv[3] ?? process.env.HOMED_CLIENT_ID;

if (!userId) {
  console.error("Usage: npx tsx scripts/list-devices.ts <userId> [clientId]");
  console.error("\nExamples:");
  console.error("  npx tsx scripts/list-devices.ts user_35917c3a30");
  console.error(
    "  npx tsx scripts/list-devices.ts user_35917c3a30 test-client"
  );
  console.error("\nOptional clientId parameter filters devices by client ID.");
  process.exit(1);
}

// Initialize Home Graph client
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/homegraph"],
});
const homegraph = google.homegraph({
  version: "v1",
  auth,
});

console.log(`=== DEVICES IN GOOGLE HOME GRAPH FOR USER ${userId} ===\n`);

try {
  // Request SYNC to get all devices
  const response = await homegraph.devices.sync({
    requestBody: {
      requestId: crypto.randomUUID(),
      agentUserId: userId,
    },
  });

  const payload = response.data.payload as any;
  const devices = payload?.devices || [];

  console.log(`Total devices: ${devices.length}\n`);

  if (devices.length === 0) {
    console.log("⚠️  No devices found in Google Home Graph!");
    console.log("This means:");
    console.log("  - No devices have been synced yet");
    console.log("  - The user may not exist");
    console.log("  - The Homed client needs to connect and sync devices");
  } else {
    // Filter by clientId if provided
    const filteredDevices = clientIdFilter
      ? devices.filter((d: any) => d.id.startsWith(clientIdFilter + "/"))
      : devices;

    if (clientIdFilter && filteredDevices.length === 0) {
      console.log(`⚠️  No devices found for client ID: ${clientIdFilter}`);
    } else {
      console.log(
        `Showing ${filteredDevices.length} device(s)${clientIdFilter ? ` for client "${clientIdFilter}"` : ""}\n`
      );
    }

    filteredDevices.forEach((device: any, index: number) => {
      console.log(`[${index + 1}] ${device.name?.name || "Unnamed Device"}`);
      console.log(`  ID: ${device.id}`);
      console.log(`  Type: ${device.type}`);
      console.log(`  Traits: ${device.traits?.join(", ") || "none"}`);

      if (device.attributes && Object.keys(device.attributes).length > 0) {
        console.log(`  Attributes:`);
        Object.entries(device.attributes).forEach(([key, value]) => {
          console.log(`    ${key}: ${JSON.stringify(value)}`);
        });
      }

      if (device.deviceInfo) {
        console.log(
          `  Manufacturer: ${device.deviceInfo.manufacturer || "Unknown"}`
        );
        console.log(`  Model: ${device.deviceInfo.model || "Unknown"}`);
      }

      if (device.customData) {
        console.log(`  Custom Data:`);
        Object.entries(device.customData).forEach(([key, value]) => {
          console.log(`    ${key}: ${JSON.stringify(value)}`);
        });
      }

      console.log();
    });

    // Extract unique client IDs from device IDs
    const clientIds = new Set(devices.map((d: any) => d.id.split("/")[0]));
    console.log("=== CONNECTED CLIENTS ===");
    console.log(`Clients with devices: ${Array.from(clientIds).join(", ")}`);
  }
} catch (error: any) {
  console.error("=== ERROR QUERYING GOOGLE HOME GRAPH ===");
  console.error(error?.message || String(error));
  if (error?.code === 404) {
    console.error("\n⚠️  User not found or no devices synced!");
  }
}
