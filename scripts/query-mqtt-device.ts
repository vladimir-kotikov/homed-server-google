#!/usr/bin/env node

/**
 * Query device data directly from MQTT broker
 * Shows raw device data before it's processed by the server
 *
 * Usage:
 *   scripts/mqtt-debug-device <deviceTopic> [mqttHost] [mqttPort]
 *
 * Examples:
 *   scripts/mqtt-debug-device "zigbee/84:fd:27:ff:fe:75:bf:44"
 *   scripts/mqtt-debug-device "zigbee/living-room-light" 192.168.10.1 1883
 */

import mqtt from "mqtt";

const [deviceTopic, mqttHost = "192.168.10.1", mqttPortStr = "1883"] =
  process.argv.slice(2);
const mqttPort = parseInt(mqttPortStr, 10);

if (!deviceTopic) {
  console.error(
    "Usage: scripts/mqtt-debug-device <deviceTopic> [mqttHost] [mqttPort]"
  );
  console.error("\nExamples:");
  console.error('  scripts/mqtt-debug-device "zigbee/84:fd:27:ff:fe:75:bf:44"');
  console.error(
    '  scripts/mqtt-debug-device "zigbee/living-room-light" 192.168.10.1 1883'
  );
  console.error("\nNote: deviceTopic should NOT include 'homed/' prefix");
  console.error("\nThis will show:");
  console.error("  - Device status (online/offline, available, etc.)");
  console.error(
    "  - Device exposes (capabilities like 'light', 'brightness', etc.)"
  );
  console.error(
    "  - Device state (current values like on/off, brightness level)"
  );
  process.exit(1);
}

console.log(`\n${"=".repeat(80)}`);
console.log(`MQTT DEVICE DEBUG: ${deviceTopic}`);
console.log(`MQTT Broker: mqtt://${mqttHost}:${mqttPort}`);
console.log(`${"=".repeat(80)}\n`);

function connectClient(useAuth: boolean) {
  console.log(
    useAuth
      ? "🔌 Connecting to MQTT broker (authenticated)..."
      : "🔌 Retrying without credentials (broker allows anonymous?)..."
  );
  return mqtt.connect(`mqtt://${mqttHost}:${mqttPort}`, {
    clientId: `debug-${Date.now()}`,
    clean: true,
    connectTimeout: 5000,
    ...(useAuth && {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
    }),
  });
}

const hasAuth = Boolean(process.env.MQTT_USERNAME || process.env.MQTT_PASSWORD);
let triedWithoutAuth = !hasAuth;
let client = connectClient(hasAuth);

const data: {
  status?: any;
  expose?: any;
  device?: any;
  state?: any;
} = {};

let receivedCount = 0;
const expectedTopics = ["status", "expose", "device", "fd"];

function attachHandlers(c: typeof client) {
  c.on("connect", () => {
    console.log("✅ Connected to MQTT broker\n");
    console.log("📡 Subscribing to topics:");

    // Subscribe to all relevant topics for this device
    const topics = [
      `homed/status/${deviceTopic}`,
      `homed/expose/${deviceTopic}`,
      `homed/device/${deviceTopic}`,
      `homed/fd/${deviceTopic}`,
    ];

    topics.forEach(topic => {
      c.subscribe(topic, err => {
        if (err) {
          console.error(
            `   ❌ Failed to subscribe to ${topic}: ${err.message}`
          );
        } else {
          console.log(`   ✓ ${topic}`);
        }
      });
    });

    console.log("\n⏳ Waiting for messages (timeout: 5 seconds)...\n");

    // Set timeout to exit after 5 seconds
    setTimeout(() => {
      console.log(`\n${"─".repeat(80)}`);
      console.log(`Received ${receivedCount} message(s)\n`);
      displayResults();
      c.end();
      process.exit(0);
    }, 5000);
  });

  c.on("message", (topic, message) => {
    receivedCount++;
    const topicType = topic.split("/")[1]; // Skip 'homed/' prefix

    try {
      const payload = JSON.parse(message.toString());
      console.log(`📨 ${topic}`);
      console.log(
        `   ${JSON.stringify(payload, null, 2).split("\n").join("\n   ")}\n`
      );

      // Store the data
      if (topicType === "status") {
        data.status = payload;
      } else if (topicType === "expose") {
        data.expose = payload;
      } else if (topicType === "device") {
        data.device = payload;
      } else if (topicType === "fd") {
        data.state = payload;
      }
    } catch (err) {
      console.log(`📨 ${topic}`);
      console.log(`   Raw: ${message.toString()}\n`);
    }
  });

  c.on("error", err => {
    const isAuthError = /not authorized|bad username or password/i.test(
      err.message
    );

    if (isAuthError && !triedWithoutAuth) {
      console.log(
        `⚠️  Authenticated connect rejected (${err.message}). Retrying anonymously...`
      );
      triedWithoutAuth = true;
      c.end(true);
      client = connectClient(false);
      attachHandlers(client);
      return;
    }

    console.error(`❌ MQTT Error: ${err.message}`);
    process.exit(1);
  });
}

attachHandlers(client);

function displayResults() {
  console.log(`\n${"=".repeat(80)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(80)}\n`);

  if (data.expose) {
    console.log("📋 DEVICE EXPOSES (capabilities)");
    console.log("─".repeat(80));
    console.log(JSON.stringify(data.expose, null, 2));

    // Extract useful info
    if (data.expose.common?.items) {
      console.log(`\nCapabilities: ${data.expose.common.items.join(", ")}`);
    }
    if (data.expose.common?.options) {
      console.log("\nOptions:");
      Object.entries(data.expose.common.options).forEach(([key, value]) => {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      });
    }
    console.log();
  }

  if (data.device) {
    console.log("\n📱 DEVICE INFO");
    console.log("─".repeat(80));
    console.log(JSON.stringify(data.device, null, 2));
    console.log();
  }

  if (data.status) {
    console.log("\n📊 DEVICE STATUS");
    console.log("─".repeat(80));
    console.log(JSON.stringify(data.status, null, 2));
    console.log();
  }

  if (data.state) {
    console.log("\n💾 CURRENT STATE");
    console.log("─".repeat(80));
    console.log(JSON.stringify(data.state, null, 2));
    console.log();
  }

  if (receivedCount === 0) {
    console.log("⚠️  No messages received. This could mean:");
    console.log("   - The device topic is incorrect");
    console.log("   - The device is not publishing to MQTT");
    console.log("   - The MQTT broker address is wrong");
    console.log("   - Network connectivity issues");
    console.log(
      "\nTry running the Homed client to see what topics it's using."
    );
  }

  console.log(`\n💡 MAPPING TO GOOGLE`);
  console.log("─".repeat(80));

  if (data.expose?.common?.items) {
    const items = data.expose.common.items;
    const options = data.expose.common.options || {};

    console.log("Based on the exposes:");
    items.forEach((item: string) => {
      if (item === "light") {
        console.log(`  • ${item}:`);
        console.log(`    → Google Trait: OnOff`);

        if (Array.isArray(options.light)) {
          if (options.light.includes("level")) {
            console.log(`    → Google Trait: Brightness (has 'level' option)`);
          }
          if (
            options.light.includes("color") ||
            options.light.includes("colorTemp")
          ) {
            console.log(
              `    → Google Trait: ColorSetting (has 'color'/'colorTemp' option)`
            );
          }
        }
      } else if (item === "switch" || item === "relay" || item === "outlet") {
        console.log(`  • ${item}: → Google Trait: OnOff`);
      } else if (item === "brightness") {
        console.log(`  • ${item}: → Google Trait: Brightness`);
      } else if (item === "cover" || item === "blinds") {
        console.log(`  • ${item}: → Google Trait: OpenClose`);
      }
    });
  } else {
    console.log("No expose data available to analyze mapping");
  }

  console.log(`\n${"=".repeat(80)}\n`);
}
