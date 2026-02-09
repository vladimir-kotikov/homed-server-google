#!/usr/bin/env node
/**
 * Request Google Home Graph to sync devices for a user
 * This updates device definitions (types, traits, attributes)
 * Usage: npx tsx scripts/request-sync.ts <userId>
 */

import { google } from "googleapis";

const userId = process.argv[2] ?? process.env.HOMED_USER_ID;

if (!userId) {
  console.error("Usage: npx tsx scripts/request-sync.ts <userId>");
  console.error("\nExamples:");
  console.error("  npx tsx scripts/request-sync.ts 105970409134870248485");
  console.error("  npx tsx scripts/request-sync.ts user_35917c3a30");
  console.error(
    "\nThis triggers a SYNC request to update device definitions in Google Home Graph."
  );
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

console.log(`Requesting SYNC for user ${userId}...`);

try {
  await homegraph.devices.requestSync({
    requestBody: {
      agentUserId: userId,
      async: true,
    },
  });

  console.log("✓ SYNC request sent successfully!");
  console.log(
    "\nGoogle Assistant will now query your fulfillment endpoint for updated device definitions."
  );
  console.log(
    "This may take a few seconds to propagate to all Google Home devices."
  );
} catch (error: any) {
  console.error("✗ Failed to request SYNC:");
  console.error(error?.message || String(error));
  process.exit(1);
}
