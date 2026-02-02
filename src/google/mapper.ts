/**
 * Capability Mapper Service
 * Converts between Homed device capabilities and Google Smart Home format
 */

import type { HomedDevice, HomedEndpoint } from "../device.ts";
import type { EndpointOptions } from "../homed/schema.ts";
import type { CommandMessage, DeviceState } from "../homed/types.ts";
import type { GoogleCommand } from "./schema.ts";
import { TRAIT_MAPPERS } from "./traits.ts";
import type {
  GoogleDevice,
  GoogleDeviceAttributes,
  GoogleDeviceState,
} from "./types.ts";

/**
 * Command structure for execution
 */
export interface HomedCommand {
  topic: string;
  message: CommandMessage;
}

/**
 * Device type mapping from Homed expose types to Google Smart Home device types
 */

// Google Smart Home device types
export const GOOGLE_DEVICE_TYPES = {
  SWITCH: "action.devices.types.SWITCH",
  OUTLET: "action.devices.types.OUTLET",
  LIGHT: "action.devices.types.LIGHT",
  BLINDS: "action.devices.types.BLINDS",
  LOCK: "action.devices.types.LOCK",
  THERMOSTAT: "action.devices.types.THERMOSTAT",
  SENSOR: "action.devices.types.SENSOR",
  SMOKE_DETECTOR: "action.devices.types.SMOKE_DETECTOR",
  CAMERA: "action.devices.types.CAMERA",
  GATEWAY: "action.devices.types.GATEWAY",
} as const;

/**
 * Maps Homed expose types to Google device types
 * Priority order is important - some exposes can match multiple types
 */
const DEVICE_TYPE_MAPPINGS: Record<string, string> = {
  // Simple switches and outlets
  switch: GOOGLE_DEVICE_TYPES.SWITCH,
  outlet: GOOGLE_DEVICE_TYPES.OUTLET,
  relay: GOOGLE_DEVICE_TYPES.SWITCH,

  // Lighting devices
  light: GOOGLE_DEVICE_TYPES.LIGHT,
  dimmable_light: GOOGLE_DEVICE_TYPES.LIGHT,
  color_light: GOOGLE_DEVICE_TYPES.LIGHT,
  brightness: GOOGLE_DEVICE_TYPES.LIGHT,

  // Door/Window
  lock: GOOGLE_DEVICE_TYPES.LOCK,
  door_lock: GOOGLE_DEVICE_TYPES.LOCK,

  // Window coverings
  cover: GOOGLE_DEVICE_TYPES.BLINDS,
  blinds: GOOGLE_DEVICE_TYPES.BLINDS,
  curtain: GOOGLE_DEVICE_TYPES.BLINDS,
  shutter: GOOGLE_DEVICE_TYPES.BLINDS,

  // Climate control
  thermostat: GOOGLE_DEVICE_TYPES.THERMOSTAT,
  temperature_controller: GOOGLE_DEVICE_TYPES.THERMOSTAT,

  // Sensors
  contact: GOOGLE_DEVICE_TYPES.SENSOR,
  occupancy: GOOGLE_DEVICE_TYPES.SENSOR,
  motion: GOOGLE_DEVICE_TYPES.SENSOR,
  temperature: GOOGLE_DEVICE_TYPES.SENSOR,
  humidity: GOOGLE_DEVICE_TYPES.SENSOR,
  pressure: GOOGLE_DEVICE_TYPES.SENSOR,
  co2: GOOGLE_DEVICE_TYPES.SENSOR,
  pm10: GOOGLE_DEVICE_TYPES.SENSOR,
  pm25: GOOGLE_DEVICE_TYPES.SENSOR,
  co: GOOGLE_DEVICE_TYPES.SENSOR,
  no2: GOOGLE_DEVICE_TYPES.SENSOR,

  // Smoke detector
  smoke: GOOGLE_DEVICE_TYPES.SMOKE_DETECTOR,
  water_leak: GOOGLE_DEVICE_TYPES.SENSOR,
  gas: GOOGLE_DEVICE_TYPES.SENSOR,
};

/**
 * Detect device type from exposes
 * Returns the most specific device type based on available exposes
 */
const detectDeviceType = (exposes: string[]): string => {
  if (!exposes || exposes.length === 0) {
    return GOOGLE_DEVICE_TYPES.SWITCH; // Default fallback
  }

  // Priority mapping for devices with multiple exposes
  // Light takes priority if present
  if (
    exposes.some(expose =>
      ["light", "color_light", "dimmable_light"].includes(expose)
    )
  ) {
    return GOOGLE_DEVICE_TYPES.LIGHT;
  }

  // Thermostat
  if (
    exposes.some(expose =>
      ["thermostat", "temperature_controller"].includes(expose)
    )
  ) {
    return GOOGLE_DEVICE_TYPES.THERMOSTAT;
  }

  // Lock
  if (exposes.some(expose => ["lock", "door_lock"].includes(expose))) {
    return GOOGLE_DEVICE_TYPES.LOCK;
  }

  // Cover/Blinds
  if (
    exposes.some(expose =>
      ["cover", "blinds", "curtain", "shutter"].includes(expose)
    )
  ) {
    return GOOGLE_DEVICE_TYPES.BLINDS;
  }

  // Smoke detector
  if (exposes.includes("smoke")) {
    return GOOGLE_DEVICE_TYPES.SMOKE_DETECTOR;
  }

  // Map first expose type
  const firstExpose = exposes[0];
  return DEVICE_TYPE_MAPPINGS[firstExpose] || GOOGLE_DEVICE_TYPES.SWITCH;
};

/**
 * Get device type traits based on exposes
 * Different traits work with different device types
 */
const getTraitsForExposes = (exposes: string[]): string[] => {
  const traits = new Set<string>();

  if (!exposes) {
    return [];
  }

  for (const expose of exposes) {
    switch (expose) {
      case "switch":
      case "relay":
      case "outlet":
      case "light":
      case "lock": {
        traits.add("action.devices.traits.OnOff");
        break;
      }

      case "dimmable_light": {
        traits.add("action.devices.traits.OnOff");
        traits.add("action.devices.traits.Brightness");
        break;
      }

      case "color_light": {
        traits.add("action.devices.traits.OnOff");
        traits.add("action.devices.traits.Brightness");
        traits.add("action.devices.traits.ColorSetting");
        break;
      }

      case "brightness": {
        traits.add("action.devices.traits.Brightness");
        break;
      }

      case "color": {
        traits.add("action.devices.traits.ColorSetting");
        break;
      }

      case "cover":
      case "blinds":
      case "curtain":
      case "shutter": {
        traits.add("action.devices.traits.OpenClose");
        break;
      }

      case "thermostat":
      case "temperature_controller": {
        traits.add("action.devices.traits.TemperatureSetting");
        break;
      }

      case "occupancy":
      case "motion":
      case "contact":
      case "smoke":
      case "water_leak":
      case "gas":
      case "co":
      case "co2":
      case "no2":
      case "pm10":
      case "pm25": {
        traits.add("action.devices.traits.SensorState");
        break;
      }
    }
  }

  return [...traits];
};

const mergeEndpointOptions = (endpoints: HomedEndpoint[]): EndpointOptions => {
  const merged: EndpointOptions = {};
  for (const ep of endpoints) {
    if (ep.options) {
      Object.assign(merged, ep.options);
    }
  }
  return merged;
};

/**
 * Convert a Homed device to Google Smart Home device format
 *
 * @param homedDevice - Homed device data
 * @param clientId - Unique client/service identifier
 * @returns Google device ready for SYNC intent
 */
export const mapToGoogleDevice = (
  homedDevice: HomedDevice,
  clientId: string
): GoogleDevice => {
  // Flatten all exposes from all endpoints
  const allExposes = homedDevice.endpoints
    .flatMap(ep => ep.exposes)
    .filter((expose, index, array) => array.indexOf(expose) === index); // Deduplicate

  const deviceType = detectDeviceType(allExposes);
  const traits = getTraitsForExposes(allExposes);

  // Build device ID from client and device key
  // Build the device ID from client and device key
  const googleDeviceId = `${clientId}-${homedDevice.key}`;

  // Build nicknames from alternative names
  const nicknames: string[] = [];
  if (homedDevice.description) {
    nicknames.push(homedDevice.description);
  }

  // Collect all trait attributes using properly typed collection
  const attributes: GoogleDeviceAttributes = {};
  for (const trait of TRAIT_MAPPERS) {
    if (traits.includes(trait.trait)) {
      const traitAttributes = trait.getAttributes(
        allExposes,
        mergeEndpointOptions(homedDevice.endpoints)
      );
      Object.assign(attributes, traitAttributes);
    }
  }

  const googleDevice: GoogleDevice = {
    id: googleDeviceId,
    type: deviceType,
    traits,
    name: {
      defaultNames: [homedDevice.name],
      name: homedDevice.name,
      nicknames,
    },
    // TODO: Reporting is not supported yet
    willReportState: false,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    deviceInfo: {
      manufacturer: homedDevice.manufacturer ?? "Unknown Manufacturer",
      model: homedDevice.model ?? "Unknown Model",
      hwVersion: homedDevice.version ?? "unknown",
      swVersion: homedDevice.firmware ?? "unknown",
    },
    customData: {
      homedKey: homedDevice.key,
      clientId,
      endpoints: homedDevice.endpoints.map(ep => ({
        id: ep.id,
        exposes: ep.exposes,
      })),
    },
  };

  return googleDevice;
};

/**
 * Convert Homed device state to Google state
 *
 * @param homedDevice - Homed device (for trait info)
 * @param deviceState - Current device state
 * @returns Google state object ready for QUERY intent
 */
export const mapToGoogleState = (
  homedDevice: HomedDevice,
  deviceState: DeviceState
): GoogleDeviceState => {
  const allExposes = homedDevice.endpoints
    .flatMap(endpoint => endpoint.exposes)
    .filter((expose, index, array) => array.indexOf(expose) === index);

  const traits = getTraitsForExposes(allExposes);
  const state: GoogleDeviceState = {
    online: homedDevice.available,
    status: "SUCCESS",
  };

  // Get state for each supported trait - use properly typed TraitState union
  for (const trait of TRAIT_MAPPERS) {
    if (traits.includes(trait.trait)) {
      const traitState = trait.getState(deviceState);
      if (traitState) {
        Object.assign(state, traitState);
      }
    }
  }

  return state;
};

/**
 * Convert Google command to Homed topic/message
 *
 * @param homedDevice - Homed device (for routing)
 * @param googleCommand - Google command to execute
 * @returns Command with topic and message, or null if not supported
 */
export const mapToHomedCommand = (
  homedDevice: HomedDevice,
  googleCommand: GoogleCommand
): HomedCommand | undefined => {
  const allExposes = homedDevice.endpoints
    .flatMap(ep => ep.exposes)
    .filter((expose, index, array) => array.indexOf(expose) === index);

  const traits = getTraitsForExposes(allExposes);

  // Find matching trait mapper
  for (const trait of TRAIT_MAPPERS) {
    if (traits.includes(trait.trait)) {
      const command = trait.mapCommand(homedDevice.key, googleCommand);
      if (command) {
        return command;
      }
    }
  }

  return;
};
