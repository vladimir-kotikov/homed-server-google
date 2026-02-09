/**
 * Capability Mapper Service
 * Converts between Homed device capabilities and Google Smart Home format
 */

import type { DeviceId, HomedDevice, HomedEndpoint } from "../device.ts";
import type { ClientId } from "../homed/client.ts";
import type { EndpointOptions } from "../homed/schema.ts";
import type { CommandMessage, DeviceState } from "../homed/types.ts";
import type { GoogleCommand } from "./schema.ts";
import { TRAIT_MAPPERS } from "./traits.ts";
import type {
  GoogleDevice,
  GoogleDeviceAttributes,
  GoogleDeviceId,
  GoogleDeviceState,
} from "./types.ts";

/**
 * Creates a Google device ID from clientId (unique client identifier) and homed device key
 * Uses clientId instead of clientToken to avoid exposing secrets
 * Optionally includes endpoint ID for multi-endpoint devices
 */
export const toGoogleDeviceId = (
  clientId: ClientId,
  homedDeviceKey: string,
  endpointId?: number
): GoogleDeviceId => {
  const base = `${clientId}/${homedDeviceKey}`;
  return (
    endpointId !== undefined ? `${base}:${endpointId}` : base
  ) as GoogleDeviceId;
};

/**
 * Extracts the homed device key from a Google device ID
 */
export const fromGoogleDeviceId = (googleDeviceId: GoogleDeviceId): string => {
  const parts = googleDeviceId.split("/");
  // Device key is everything after the first slash
  const withEndpoint = parts.slice(1).join("/");
  // Remove endpoint ID if present
  return withEndpoint.split(":")[0];
};

/**
 * Extracts the clientId from a Google device ID
 */
export const getClientIdFromGoogleDeviceId = (
  googleDeviceId: GoogleDeviceId
): ClientId => {
  return googleDeviceId.split("/")[0] as ClientId;
};

/**
 * Extracts the endpoint ID from a Google device ID (if present)
 */
export const getEndpointIdFromGoogleDeviceId = (
  googleDeviceId: GoogleDeviceId
): number | undefined => {
  const parts = googleDeviceId.split(":");
  return parts.length > 1 ? parseInt(parts[1], 10) : undefined;
};

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
  // Outlet takes priority over light if present
  if (exposes.includes("outlet")) {
    return GOOGLE_DEVICE_TYPES.OUTLET;
  }

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
 * Get device type traits based on exposes and options
 * Different traits work with different device types
 * Options are checked for additional capabilities (e.g., light with level = brightness)
 */
const getTraitsForExposes = (
  exposes: string[],
  options?: EndpointOptions
): string[] => {
  const traits = new Set<string>();

  if (!exposes) {
    return [];
  }

  for (const expose of exposes) {
    switch (expose) {
      case "switch":
      case "relay":
      case "outlet":
      case "lock": {
        traits.add("action.devices.traits.OnOff");
        break;
      }

      case "light": {
        traits.add("action.devices.traits.OnOff");
        // Check if light has level option (brightness control)
        const lightOptions = options?.light;
        // FIXME: This is a hack for INSPELLNIG sockets from IKEA which do
        // not currently have good support in Homed and expose "light" with
        // "level" where level is power measurement, not brightness, so skip
        // brightness trait if device has power/energy monitoring (indicates
        // level is power, not brightness)
        const hasPowerMonitoring = exposes.some(e =>
          ["power", "energy", "voltage", "current"].includes(e)
        );
        if (
          Array.isArray(lightOptions) &&
          lightOptions.includes("level") &&
          !hasPowerMonitoring
        ) {
          traits.add("action.devices.traits.Brightness");
        }
        // Check if light has color option
        if (
          Array.isArray(lightOptions) &&
          (lightOptions.includes("color") ||
            lightOptions.includes("colorTemperature"))
        ) {
          traits.add("action.devices.traits.ColorSetting");
        }
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
        // Add OnOff if there's a light present, otherwise just brightness
        if (exposes.includes("light")) {
          traits.add("action.devices.traits.OnOff");
        }
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
 * Determines if an endpoint has control capabilities (vs just metadata)
 */
const hasControlCapabilities = (exposes: string[]): boolean => {
  const controlExposes = [
    "switch",
    "relay",
    "outlet",
    "light",
    "dimmable_light",
    "color_light",
    "brightness",
    "color",
    "cover",
    "blinds",
    "curtain",
    "shutter",
    "lock",
    "door_lock",
    "thermostat",
    "temperature_controller",
  ];
  return exposes.some(expose => controlExposes.includes(expose));
};

/**
 * Get the primary device-level expose from an endpoint
 * Returns the most significant control capability that defines the device type
 */
const getPrimaryExpose = (exposes: string[]): string | undefined => {
  // Priority order: specific device types first, then generic attributes
  const priorities = [
    "color_light",
    "dimmable_light",
    "light", // Light types (specific to general)
    "outlet",
    "relay",
    "switch", // Switch types (specific to general)
    "blinds",
    "curtain",
    "shutter",
    "cover", // Cover types
    "door_lock",
    "lock", // Lock types
    "thermostat",
    "temperature_controller", // Climate types
  ];

  for (const primary of priorities) {
    if (exposes.includes(primary)) {
      return primary;
    }
  }

  return undefined;
};

/**
 * Determines if all control endpoints have the same primary control expose
 * Used to decide if a multi-endpoint device should be split into multiple Google devices
 * Only splits if endpoints have the SAME independently-controllable capability (like multiple switches)
 */
const areAllSameDeviceType = (endpoints: HomedEndpoint[]): boolean => {
  if (endpoints.length <= 1) return false;

  // Get the primary expose for each endpoint
  const primaryExposes = endpoints.map(ep => getPrimaryExpose(ep.exposes));

  // Filter out undefined (endpoints with no primary expose)
  const validPrimaries = primaryExposes.filter(p => p !== undefined);
  if (validPrimaries.length <= 1) return false;

  // Check if all primary exposes are the same
  const firstPrimary = validPrimaries[0];
  return validPrimaries.every(primary => primary === firstPrimary);
};

/**
 * Build device name arrays for Google Smart Home
 * Returns defaultNames (what Google displays) and nicknames (alternative names)
 */
const buildDeviceNames = (
  name: string,
  description: string | undefined,
  manufacturer: string | undefined,
  model: string | undefined,
  suffix = ""
): { defaultNames: string[]; nicknames: string[] } => {
  // Use only user-friendly name for defaultNames (what Google displays)
  // Google Home may use alternative names from the array, causing confusion
  const defaultNames: string[] = [name + suffix];

  // Put description and manufacturer info in nicknames for voice commands
  const nicknames: string[] = [];
  if (description) {
    nicknames.push(description + suffix);
  }
  if (manufacturer && model) {
    nicknames.push(`${manufacturer} ${model}${suffix}`);
  } else if (model) {
    nicknames.push(model + suffix);
  } else if (manufacturer) {
    nicknames.push(manufacturer + suffix);
  }

  return { defaultNames, nicknames };
};

/**
 * Build a complete Google Smart Home device object
 * Consolidates device type detection, trait mapping, attribute collection, and structure building
 */
const buildGoogleDevice = (
  homedDevice: HomedDevice,
  clientId: ClientId,
  exposes: string[],
  options: EndpointOptions,
  endpoint?: HomedEndpoint
): GoogleDevice => {
  const deviceType = detectDeviceType(exposes);
  const traits = getTraitsForExposes(exposes, options);
  const googleDeviceId = toGoogleDeviceId(
    clientId,
    homedDevice.key,
    endpoint?.id
  );

  // Build name suffix for multi-endpoint devices
  const suffix = endpoint?.id !== undefined ? ` - Switch ${endpoint?.id}` : "";
  const name = homedDevice.name + suffix;

  const { defaultNames, nicknames } = buildDeviceNames(
    homedDevice.name,
    homedDevice.description,
    homedDevice.manufacturer,
    homedDevice.model,
    suffix
  );

  // Collect trait attributes
  const attributes: GoogleDeviceAttributes = {};
  for (const trait of TRAIT_MAPPERS) {
    if (traits.includes(trait.trait)) {
      const traitAttributes = trait.getAttributes(exposes, options);
      Object.assign(attributes, traitAttributes);
    }
  }

  return {
    id: googleDeviceId,
    type: deviceType,
    traits,
    name: {
      defaultNames,
      name,
      nicknames,
    },
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
      endpointId: endpoint?.id,
      endpoints: endpoint
        ? [{ id: endpoint.id, exposes: endpoint.exposes }]
        : homedDevice.endpoints.map(ep => ({
            id: ep.id,
            exposes: ep.exposes,
          })),
    },
  };
};

/**
 * Get all Google device IDs for a Homed device
 * Returns array of IDs based on whether the device should be split into multiple Google devices
 *
 * @param homedDevice - Homed device
 * @param clientId - Unique client/service identifier
 * @returns Array of Google device IDs that exist for this device
 */
export const getGoogleDeviceIds = (
  homedDevice: HomedDevice,
  clientId: ClientId
): GoogleDeviceId[] => {
  // Find all endpoints with control capabilities
  const controlEndpoints = homedDevice.endpoints.filter(ep =>
    hasControlCapabilities(ep.exposes)
  );

  // Determine if device should be split (same logic as mapToGoogleDevices)
  const shouldSplit =
    controlEndpoints.length > 1 && areAllSameDeviceType(controlEndpoints);

  if (shouldSplit) {
    // Multiple control endpoints of same type - return ID for each endpoint
    return controlEndpoints.map(endpoint =>
      toGoogleDeviceId(clientId, homedDevice.key, endpoint.id)
    );
  }

  // Single device - return single ID
  return [toGoogleDeviceId(clientId, homedDevice.key)];
};

/**
 * Convert a Homed device to Google Smart Home device format(s)
 * Returns an array because multi-endpoint devices are split into separate Google devices
 *
 * @param homedDevice - Homed device data
 * @param clientId - Unique client/service identifier
 * @returns Array of Google devices ready for SYNC intent
 */
export const mapToGoogleDevices = (
  homedDevice: HomedDevice,
  clientId: ClientId
): GoogleDevice[] => {
  // Find all endpoints with control capabilities
  const controlEndpoints = homedDevice.endpoints.filter(ep =>
    hasControlCapabilities(ep.exposes)
  );

  // Determine if device should be split into multiple Google devices
  // Only split if there are 2+ control endpoints AND they're all the same type
  const shouldSplit =
    controlEndpoints.length > 1 && areAllSameDeviceType(controlEndpoints);

  // If not splitting, treat as single device
  if (!shouldSplit) {
    // Single device: flatten all exposes from all endpoints
    const allExposes = homedDevice.endpoints
      .flatMap(ep => ep.exposes)
      .filter((expose, index, array) => array.indexOf(expose) === index);

    return [
      buildGoogleDevice(
        homedDevice,
        clientId,
        allExposes,
        mergeEndpointOptions(homedDevice.endpoints)
      ),
    ];
  }

  // Multiple control endpoints of same type - create separate Google device for each
  return controlEndpoints
    .map(endpoint => {
      const traits = getTraitsForExposes(endpoint.exposes, endpoint.options);
      // Skip if no traits (shouldn't happen for control endpoints)
      if (traits.length === 0) {
        return undefined;
      }

      return buildGoogleDevice(
        homedDevice,
        clientId,
        endpoint.exposes,
        endpoint.options ?? {},
        endpoint
      );
    })
    .filter((device): device is GoogleDevice => device !== undefined);
};

/**
 * Convert a Homed device to Google Smart Home device format
 * Legacy function for backward compatibility - simply returns the first device from mapToGoogleDevices
 *
 * @param homedDevice - Homed device data
 * @param clientId - Unique client/service identifier
 * @returns Google device ready for SYNC intent
 */
export const mapToGoogleDevice = (
  homedDevice: HomedDevice,
  clientId: ClientId
): GoogleDevice => {
  return mapToGoogleDevices(homedDevice, clientId)[0];
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

  const mergedOptions = mergeEndpointOptions(homedDevice.endpoints);
  const traits = getTraitsForExposes(allExposes, mergedOptions);
  const state: GoogleDeviceState = {
    online: homedDevice.available,
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
 * Map device state to Google state reports for all control endpoints
 * Returns an array because multi-endpoint devices need separate state reports
 *
 * @param homedDevice - Homed device (for trait info)
 * @param clientId - Unique client/service identifier
 * @param deviceId - Device ID for building Google device ID
 * @param deviceState - Current device state
 * @returns Array of {googleDeviceId, googleState} tuples for state reporting
 */
export const mapToGoogleStateReports = (
  homedDevice: HomedDevice,
  clientId: ClientId,
  deviceId: DeviceId,
  deviceState: DeviceState
): Array<{
  googleDeviceId: GoogleDeviceId;
  googleState: GoogleDeviceState;
}> => {
  // Find all endpoints with control capabilities
  const controlEndpoints = homedDevice.endpoints.filter(ep =>
    hasControlCapabilities(ep.exposes)
  );

  // Determine if device should be split (same logic as mapToGoogleDevices)
  const shouldSplit =
    controlEndpoints.length > 1 && areAllSameDeviceType(controlEndpoints);

  // Multiple control endpoints of same type - report state for each separately
  if (shouldSplit) {
    return controlEndpoints.map(endpoint => {
      // Create filtered device with only this endpoint for accurate state mapping
      const endpointDevice = { ...homedDevice, endpoints: [endpoint] };
      const googleState = mapToGoogleState(endpointDevice, deviceState);
      const googleDeviceId = toGoogleDeviceId(clientId, deviceId, endpoint.id);
      return { googleDeviceId, googleState };
    });
  }

  // Single device - report state once
  const googleState = mapToGoogleState(homedDevice, deviceState);
  const googleDeviceId = toGoogleDeviceId(clientId, deviceId);
  return [{ googleDeviceId, googleState }];
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

  const mergedOptions = mergeEndpointOptions(homedDevice.endpoints);
  const traits = getTraitsForExposes(allExposes, mergedOptions);

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
