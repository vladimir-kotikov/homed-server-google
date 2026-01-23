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
export const DEVICE_TYPE_MAPPINGS: Record<string, string> = {
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
export function detectDeviceType(exposes: string[]): string {
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
}

/**
 * Get device type traits based on exposes
 * Different traits work with different device types
 */
export function getTraitsForExposes(exposes: string[]): string[] {
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
}
