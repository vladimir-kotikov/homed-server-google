#!/usr/bin/env node

import { Command } from "commander";
import mqtt from "mqtt";

const program = new Command();

program
  .name("zigbee-cmd")
  .description(
    "Send raw ZigBee commands to a ZigBee device via MQTT and receive the first response"
  )
  .version("1.0.0")
  .argument(
    "<device-id>",
    "Device IEEE address (e.g., f8:44:77:ff:fe:f7:d2:39)"
  )
  .option("-c, --cluster <id>", "ZigBee cluster ID in decimal or hex", "0")
  .option("--command <id>", "Command ID in decimal", "0")
  .option("-e, --endpoint <id>", "Endpoint ID in decimal", "1")
  .option("-p, --payload <hex>", "Hex payload string", "")
  .option("-m, --manufacturer <code>", "Manufacturer code in decimal or hex")
  .option(
    "--cluster-specific",
    "Use cluster-specific request (default: global)",
    false
  )
  .option("--expose", "Print expose/device/fd topics for the device", false)
  .option("--status", "Print homed/status/zigbee payload", false)
  .option("--host <address>", "MQTT broker host", "192.168.10.1")
  .option("--port <number>", "MQTT broker port", "1883")
  .option("--timeout <seconds>", "Response timeout", "5")
  .addHelpText(
    "after",
    `

Examples:

  # Read Basic cluster (cluster 0, command 0)
  $ zigbee-cmd "Living room - Desk socket" --cluster 0 --command 0

  # Print expose/device/fd topics
  $ zigbee-cmd "f8:44:77:ff:fe:f7:d2:39" --expose

  # Print ZigBee status payload
  $ zigbee-cmd "f8:44:77:ff:fe:f7:d2:39" --status

  # Toggle On/Off (cluster 6, command 2)
  $ zigbee-cmd "desk lamp" -c 6 --command 2

  # Set level to 40% with 8 second transition
  $ zigbee-cmd "dimmer" -c 8 --command 0 -p "40000800"

  # Read energy metering (cluster 1794)
  $ zigbee-cmd "f8:44:77:ff:fe:f7:d2:39" -c 1794 --command 0 -e 1

  # Read electrical measurement on endpoint 2
  $ zigbee-cmd "kitchen lamp" -c 2820 --command 0 -e 2

Common ZigBee Clusters:
  0     Basic
  1     Power Configuration
  3     Identify
  6     On/Off
  8     Level Control
  768   Color Control
  1024  Illuminance Measurement
  1026  Temperature Measurement
  1029  Humidity Measurement
  1794  Metering (Energy)
  2820  Electrical Measurement
`
  );

program.parse();

const opts = program.opts();
const device = program.args[0];

const args = {
  device,
  cluster: parseInt(opts.cluster, 0),
  command: parseInt(opts.command, 0),
  endpoint: parseInt(opts.endpoint, 0),
  payload: opts.payload,
  manufacturerCode: opts.manufacturer
    ? parseInt(opts.manufacturer, 0)
    : undefined,
  clusterSpecific: opts.clusterSpecific,
  host: opts.host,
  port: parseInt(opts.port, 0),
  timeout: parseInt(opts.timeout, 0),
  expose: opts.expose,
  status: opts.status,
};

console.log(`\n${"=".repeat(80)}`);
if (args.status) {
  console.log(`ZigBee Status Snapshot`);
} else if (args.expose) {
  console.log(`ZigBee Expose/State Snapshot: ${args.device}`);
} else {
  console.log(`ZigBee Command to Device: ${args.device}`);
}
console.log(`${"=".repeat(80)}`);
if (!args.expose && !args.status) {
  console.log(
    `Cluster:   0x${args.cluster.toString(16).padStart(4, "0")} (${args.cluster})`
  );
  console.log(`Command:   ${args.command}`);
  console.log(`Endpoint:  ${args.endpoint}`);
  console.log(`Payload:   ${args.payload || "(empty)"}`);
  if (args.manufacturerCode) {
    console.log(
      `Manufacturer: 0x${args.manufacturerCode.toString(16).padStart(4, "0")}`
    );
  }
  console.log(
    `Type:      ${args.clusterSpecific ? "Cluster-specific" : "Global"}`
  );
}
console.log(`${"=".repeat(80)}\n`);

const client = mqtt.connect(`mqtt://${args.host}:${args.port}`, {
  clientId: `zigbee-cmd-${Date.now()}`,
  clean: true,
  connectTimeout: 5000,
});

let receivedResponse = false;

client.on("connect", () => {
  console.log("🔌 Connected to MQTT broker");
  console.log("📡 Listening for responses...\n");

  if (args.status) {
    client.subscribe("homed/status/zigbee", err => {
      if (err) {
        console.error(`❌ Failed to subscribe: ${err.message}`);
        process.exit(1);
      }
    });
  } else if (args.expose) {
    const topics = [
      `homed/expose/zigbee/${args.device}`,
      `homed/device/zigbee/${args.device}`,
      `homed/fd/zigbee/${args.device}`,
    ];

    client.subscribe(topics, err => {
      if (err) {
        console.error(`❌ Failed to subscribe: ${err.message}`);
        process.exit(1);
      }
    });
  } else {
    // Subscribe to event responses
    client.subscribe("homed/event/zigbee/#", err => {
      if (err) {
        console.error(`❌ Failed to subscribe: ${err.message}`);
        process.exit(1);
      }
    });

    // Send command
    const command = {
      action: args.clusterSpecific ? "clusterRequest" : "globalRequest",
      device: args.device,
      endpointId: args.endpoint,
      clusterId: args.cluster,
      commandId: args.command,
      payload: args.payload,
    };

    if (args.manufacturerCode) {
      (command as any).manufacturerCode = args.manufacturerCode;
    }

    console.log("📤 Sending command...");
    client.publish("homed/command/zigbee", JSON.stringify(command));
  }

  // Timeout after specified seconds
  const timeoutHandle = setTimeout(() => {
    if (!receivedResponse) {
      console.log(`\n⏱️  No response received within ${args.timeout} seconds`);
      console.log(
        args.status
          ? "   Status message not received (broker may not retain it)"
          : args.expose
            ? "   Device may not be online or not publishing expose/fd topics"
            : "   Device may not be online or not supporting this command"
      );
    }
    client.end();
    process.exit(receivedResponse ? 0 : 1);
  }, args.timeout * 1000);
});

client.on("message", (topic, message) => {
  try {
    // Display all responses received
    if (!receivedResponse) {
      console.log("✅ Responses received:\n");
      receivedResponse = true;
    }

    if (args.status) {
      console.log(`📥 Topic: ${topic}`);
      console.log(JSON.stringify(message, null, 2));
      console.log();
      client.end();
      process.exit(0);
    }

    if (args.expose) {
      console.log(`📥 Topic: ${topic}`);
      console.log(JSON.stringify(message, null, 2));
      console.log();
      return;
    }

    displayResponse(message);
  } catch (err) {
    // Ignore parse errors
  }
});

client.on("error", (err: any) => {
  console.error(`\n❌ MQTT Error: ${err.message}`);
  process.exit(1);
});

function displayResponse(data: any) {
  console.log(`📨 Event: ${data.event}`);
  console.log(
    `   Cluster:      0x${data.clusterId.toString(16).padStart(4, "0")}`
  );
  console.log(`   Command:      ${data.commandId}`);
  console.log(`   Endpoint:     ${data.endpointId}`);
  console.log(`   Transaction:  ${data.transactionId}`);

  if (data.payload) {
    console.log(`   Payload (hex): ${data.payload}`);

    // Try to decode common payload formats
    try {
      const decoded = decodePayload(
        data.clusterId,
        data.commandId,
        data.payload
      );
      if (decoded) {
        console.log(`   Decoded:`);
        Object.entries(decoded).forEach(([key, value]) => {
          console.log(`     ${key}: ${value}`);
        });
      }
    } catch (e) {
      // Ignore decode errors
    }
  } else {
    console.log(`   Payload:      (empty)`);
  }

  console.log();
}

function decodeReadAttributesResponse(buf: Buffer): Record<string, any> | null {
  const decoded: Record<string, any> = {};
  let offset = 0;
  let attrCount = 0;

  // ZigBee attribute names
  const attributeNames: Record<number, string> = {
    0x0000: "ZCL Version",
    0x0001: "Application Version",
    0x0002: "Stack Version",
    0x0003: "Hardware Version",
    0x0004: "Manufacturer Name",
    0x0005: "Model Identifier",
    0x0006: "Date Code",
    0x0007: "Power Source",
    0x4000: "SW Build ID",
  };

  while (offset < buf.length - 2) {
    // Read attribute ID (2 bytes, little-endian)
    const attrId = buf.readUInt16LE(offset);
    offset += 2;

    if (offset >= buf.length) break;

    // Read status (1 byte)
    const status = buf[offset];
    offset += 1;

    const attrName =
      attributeNames[attrId] ||
      `Attribute 0x${attrId.toString(16).padStart(4, "0")}`;

    if (status !== 0x00) {
      decoded[attrName] = `Error: Status 0x${status.toString(16)}`;
      attrCount++;
      continue;
    }

    if (offset >= buf.length) break;

    // Read data type (1 byte)
    const dataType = buf[offset];
    offset += 1;

    let value: any = null;

    try {
      switch (dataType) {
        case 0x10: // Boolean
          value = buf[offset] !== 0;
          offset += 1;
          break;
        case 0x20: // Uint8
          value = buf[offset];
          offset += 1;
          break;
        case 0x21: // Uint16
          value = buf.readUInt16LE(offset);
          offset += 2;
          break;
        case 0x22: // Uint24
          value = buf.readUIntLE(offset, 3);
          offset += 3;
          break;
        case 0x23: // Uint32
          value = buf.readUInt32LE(offset);
          offset += 4;
          break;
        case 0x28: // Int8
          value = buf.readInt8(offset);
          offset += 1;
          break;
        case 0x29: // Int16
          value = buf.readInt16LE(offset);
          offset += 2;
          break;
        case 0x2a: // Int24
          value = buf.readIntLE(offset, 3);
          offset += 3;
          break;
        case 0x2b: // Int32
          value = buf.readInt32LE(offset);
          offset += 4;
          break;
        case 0x30: // Enum8
          value = `Enum: ${buf[offset]}`;
          offset += 1;
          break;
        case 0x41: // Octet String
        case 0x42: // Character String
          if (offset >= buf.length) break;
          const length = buf[offset];
          offset += 1;
          if (offset + length <= buf.length) {
            const str = buf.toString("utf8", offset, offset + length);
            value = dataType === 0x42 ? `"${str}"` : `[${length} bytes]`;
            offset += length;
          }
          break;
        default:
          value = `Unknown type 0x${dataType.toString(16)}`;
      }

      decoded[attrName] = value;
      attrCount++;
    } catch (e) {
      decoded[attrName] = "Parse error";
      break;
    }
  }

  return attrCount > 0 ? decoded : null;
}

function decodePayload(
  clusterId: number,
  commandId: number,
  payload: string
): Record<string, any> | null {
  if (!payload || payload.length < 2) {
    return null;
  }

  // Remove colons from payload if present
  const cleanPayload = payload.replace(/:/g, "");
  const buf = Buffer.from(cleanPayload, "hex");
  const decoded: Record<string, any> = {};

  // Global command responses
  if (commandId === 1) {
    // Read Attributes Response
    return decodeReadAttributesResponse(buf);
  }

  // Cluster-specific decoders
  switch (clusterId) {
    case 0x0006: // On/Off
      if (commandId === 0) {
        decoded["status"] = buf[0] === 0 ? "off" : "on";
      }
      break;

    case 0x0008: // Level Control
      if (commandId === 0 && buf.length >= 2) {
        const level = buf[0];
        const transitionTime = buf.readUInt16LE(1);
        decoded["level"] = level;
        decoded["transitionTime"] = `${transitionTime * 100}ms`;
      }
      break;

    case 0x0702: // Metering (Energy)
      if (buf.length >= 4) {
        const value = buf.readUInt32LE(0);
        decoded["energy_raw"] = value;
        decoded["energy_kWh"] = (value / 1000).toFixed(3);
      }
      break;

    case 0x0b04: // Electrical Measurement
      if (buf.length >= 2) {
        const value = buf.readUInt16LE(0);
        decoded["value"] = value;
        // Could be voltage, current, or power depending on attribute
      }
      break;

    default:
      // Generic hex display
      if (buf.length <= 8) {
        decoded["hex"] = payload;
        decoded["bytes"] = Array.from(buf)
          .map(b => "0x" + b.toString(16).padStart(2, "0"))
          .join(" ");
      }
  }

  return Object.keys(decoded).length > 0 ? decoded : null;
}
