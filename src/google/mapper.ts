/**
 * Capability Mapper Service
 * Converts between Homed device capabilities and Google Smart Home format
 */

import type { UserId } from "../db/repository.ts";
import type {
  DeviceId,
  DeviceWithState,
  HomedDevice,
  HomedEndpoint,
} from "../device.ts";
import type { ClientId } from "../homed/client.ts";
import type { EndpointOptions } from "../homed/schema.ts";
import type { CommandMessage, DeviceState } from "../homed/types.ts";
import { fastDeepEqual, filterDict, mergeDicts } from "../utility.ts";
import type { GoogleCommand } from "./schema.ts";
import { TRAIT_MAPPERS } from "./traits.ts";
import type {
  GoogleDevice,
  GoogleDeviceAttributes,
  GoogleDeviceId,
  GoogleDeviceState,
  QueryResponsePayload,
  SyncResponsePayload,
} from "./types.ts";

/**
 * Creates a Google device ID from clientId (unique client identifier) and homed device key
 * Optionally includes endpoint ID for multi-endpoint devices
 */
export const toGoogleDeviceId = (
  clientId: ClientId,
  homedDeviceKey: string,
  endpointId?: number
): GoogleDeviceId => {
  const base = `${clientId}/${homedDeviceKey}`;
  return (
    endpointId !== undefined ? `${base}#${endpointId}` : base
  ) as GoogleDeviceId;
};

export const fromGoogleDeviceId = (
  googleId: GoogleDeviceId
): {
  clientId: ClientId;
  deviceId: DeviceId;
  endpointId?: number;
} => {
  const [clientId, devicePart] = googleId.split("/");
  const [deviceId, endpointPart] = devicePart.split("#");
  const endpointId = endpointPart ? parseInt(endpointPart, 10) : undefined;
  return {
    clientId: clientId as ClientId,
    deviceId: deviceId as DeviceId,
    endpointId,
  };
};

/**
 * Extracts the endpoint ID from a Google device ID (if present)
 * Format: clientId/deviceKey or clientId/deviceKey#<number>
 */
export const getEndpointIdFromGoogleDeviceId = (
  googleDeviceId: GoogleDeviceId
): number | undefined => {
  const match = googleDeviceId.match(/#(\d+)$/);
  return match ? parseInt(match[1], 10) : undefined;
};

/**
 * Execution request context with device and command info
 */
export interface ExecutionRequest {
  userId: UserId;
  googleDeviceIds: GoogleDeviceId[];
  commands: GoogleCommand[];
}

/**
 * Command ready to send to a Homed device
 */
export interface CommandToSend {
  userId: UserId;
  clientId: ClientId;
  deviceId: DeviceId;
  endpointId?: number;
  googleDeviceIds: GoogleDeviceId[]; // Google devices this command affects
  message: CommandMessage;
}

/**
 * Device type mapping from Homed expose types to Google Smart Home device types
 */

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
 * Priority-ordered list of expose types for device type detection
 * Earlier entries have higher priority when multiple control types are present
 *
 * Note: This ordering reflects UI/UX priorities. For multi-function devices,
 * we want to prioritize the type that users will most commonly control.
 */
const DEVICE_TYPE_PRIORITY: Array<{ exposes: string[]; type: string }> = [
  // Special sensors (highest priority for safety devices)
  { exposes: ["smoke"], type: GOOGLE_DEVICE_TYPES.SMOKE_DETECTOR },

  // Generic sensors (high priority to catch sensor-primary devices)
  {
    exposes: [
      "temperature",
      "humidity",
      "pressure",
      "co2",
      "pm10",
      "pm25",
      "co",
      "no2",
      "contact",
      "occupancy",
      "motion",
      "water_leak",
      "gas",
    ],
    type: GOOGLE_DEVICE_TYPES.SENSOR,
  },

  // Outlets (priority over generic switch)
  { exposes: ["outlet"], type: GOOGLE_DEVICE_TYPES.OUTLET },

  // Lights (high priority for multi-function devices)
  {
    exposes: ["light", "color_light", "dimmable_light"],
    type: GOOGLE_DEVICE_TYPES.LIGHT,
  },
  { exposes: ["lock", "door_lock"], type: GOOGLE_DEVICE_TYPES.LOCK },
  {
    exposes: ["thermostat", "temperature_controller"],
    type: GOOGLE_DEVICE_TYPES.THERMOSTAT,
  },
  {
    exposes: ["cover", "blinds", "curtain", "shutter"],
    type: GOOGLE_DEVICE_TYPES.BLINDS,
  },
  // Switches (lowest priority - catch-all for control devices)
  { exposes: ["switch", "relay"], type: GOOGLE_DEVICE_TYPES.SWITCH },
];

// Handle special case for "brightness" - add OnOff if light is present
const handleBrightnessExpose = (exposes: string[]): string[] => {
  return exposes.includes("light")
    ? ["action.devices.traits.OnOff", "action.devices.traits.Brightness"]
    : ["action.devices.traits.Brightness"];
};

// Handle special case for "light" with options
const handleLightExpose = (
  exposes: string[],
  options?: EndpointOptions
): string[] => {
  const traits = ["action.devices.traits.OnOff"];

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
    traits.push("action.devices.traits.Brightness");
  }

  // Check if light has color option
  if (
    Array.isArray(lightOptions) &&
    (lightOptions.includes("color") ||
      lightOptions.includes("colorTemperature"))
  ) {
    traits.push("action.devices.traits.ColorSetting");
  }
  return traits;
};

/**
 * Mapping of Homed expose types to Google traits
 * Multiple exposes may contribute to the same trait
 */
const EXPOSE_TO_TRAITS: Record<
  string,
  string[] | ((exposes: string[], options?: EndpointOptions) => string[])
> = {
  switch: ["action.devices.traits.OnOff"],
  relay: ["action.devices.traits.OnOff"],
  outlet: ["action.devices.traits.OnOff"],
  lock: ["action.devices.traits.OnOff"],
  // Light with potential brightness/color options needs special handling
  light: handleLightExpose,
  // Brightness and dimmable lights may add OnOff if light is present
  dimmable_light: handleBrightnessExpose,
  brightness: handleBrightnessExpose,
  color_light: [
    "action.devices.traits.OnOff",
    "action.devices.traits.Brightness",
    "action.devices.traits.ColorSetting",
  ],
  color: ["action.devices.traits.ColorSetting"],
  cover: ["action.devices.traits.OpenClose"],
  blinds: ["action.devices.traits.OpenClose"],
  curtain: ["action.devices.traits.OpenClose"],
  shutter: ["action.devices.traits.OpenClose"],
  thermostat: ["action.devices.traits.TemperatureSetting"],
  temperature_controller: ["action.devices.traits.TemperatureSetting"],
  temperature: ["action.devices.traits.TemperatureSetting"],
  humidity: ["action.devices.traits.TemperatureSetting"],
  occupancy: ["action.devices.traits.SensorState"],
  motion: ["action.devices.traits.SensorState"],
  contact: ["action.devices.traits.SensorState"],
  smoke: ["action.devices.traits.SensorState"],
  water_leak: ["action.devices.traits.SensorState"],
  gas: ["action.devices.traits.SensorState"],
  co: ["action.devices.traits.SensorState"],
  co2: ["action.devices.traits.SensorState"],
  no2: ["action.devices.traits.SensorState"],
  pm10: ["action.devices.traits.SensorState"],
  pm25: ["action.devices.traits.SensorState"],
  pressure: ["action.devices.traits.SensorState"],
};

/**
 * Detect device type from exposes
 * Returns the most specific device type based on available exposes
 * Uses priority-based matching for multi-function devices
 */
const detectDeviceType = (exposes: string[]): string =>
  // Find first matching device type in priority list
  // This ensures correct priority for hybrid devices
  // (e.g., light+thermostat -> light)
  DEVICE_TYPE_PRIORITY.find(({ exposes: priorityExposes }) =>
    priorityExposes.some(expose => exposes.includes(expose))
  )?.type ??
  // Default to SENSOR if no exposes
  GOOGLE_DEVICE_TYPES.SENSOR;

/**
 * Get device type traits based on exposes and options
 * Different traits work with different device types
 */
const mapExposesToTraits = (
  exposes: string[],
  options?: EndpointOptions
): string[] =>
  exposes
    .reduce((acc, expose) => {
      let exposeTraits = EXPOSE_TO_TRAITS[expose];
      if (typeof exposeTraits === "function") {
        exposeTraits = exposeTraits(exposes, options);
      }
      exposeTraits?.forEach(trait => acc.add(trait));
      return acc;
    }, new Set<string>())
    .values()
    .toArray();

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

  return priorities.find(primary => exposes.includes(primary));
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
 * Creates virtual device representations for Google Smart Home integration
 *
 * Returns an array of virtual HomedDevice objects, potentially splitting a single
 * physical device into multiple Google devices when appropriate.
 *
 * Splitting logic: A device is split into multiple Google devices when:
 * - It has 2+ endpoints with control capabilities, AND
 * - All control endpoints have the same primary device type (e.g., all switches)
 *
 * This prevents splitting devices with mixed capabilities (e.g., switch + sensor)
 * while properly handling multi-switch devices as separate Google devices.
 *
 * @param homedDevice - The physical Homed device to analyze
 * @returns Array of virtual devices:
 *   - When split: Each control endpoint becomes a separate virtual device with
 *     `virtualEndpointId` set to the endpoint's ID and `endpoints` containing only that endpoint
 *   - When not split: Returns array with single device (original, no `virtualEndpointId`)
 */
const getVirtualControlDevices = (
  homedDevice: HomedDevice
): (HomedDevice & { endpointId?: number })[] => {
  const controlEndpoints = homedDevice.endpoints.filter(ep =>
    hasControlCapabilities(ep.exposes)
  );

  const shouldSplit =
    controlEndpoints.length > 1 && areAllSameDeviceType(controlEndpoints);

  return shouldSplit
    ? controlEndpoints.map(ep => ({
        ...homedDevice,
        endpointId: ep.id,
        endpoints: [ep],
      }))
    : [homedDevice];
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
const mapToGoogleDevice = (
  homedDevice: HomedDevice,
  clientId: ClientId,
  exposes: string[],
  options: EndpointOptions,
  endpointId?: number
): GoogleDevice => {
  const deviceType = detectDeviceType(exposes);
  const traits = mapExposesToTraits(exposes, options);
  const googleDeviceId = toGoogleDeviceId(
    clientId,
    homedDevice.key,
    endpointId
  );

  // Build name suffix for multi-endpoint devices
  const suffix = endpointId !== undefined ? ` - Switch ${endpointId}` : "";
  const name = homedDevice.name + suffix;

  const { defaultNames, nicknames } = buildDeviceNames(
    homedDevice.name,
    homedDevice.description,
    homedDevice.manufacturer,
    homedDevice.model,
    suffix
  );

  // Collect trait attributes
  const attributes = traits
    .map(trait => TRAIT_MAPPERS[trait]?.getAttributes(exposes, options))
    .reduce(mergeDicts, {});

  return {
    id: googleDeviceId,
    type: deviceType,
    traits,
    name: {
      defaultNames,
      name,
      nicknames,
    },
    willReportState: true,
    attributes:
      Object.keys(attributes).length > 0
        ? (attributes as GoogleDeviceAttributes)
        : undefined,
    deviceInfo: {
      manufacturer: homedDevice.manufacturer ?? "Unknown Manufacturer",
      model: homedDevice.model ?? "Unknown Model",
      hwVersion: homedDevice.version ?? "unknown",
      swVersion: homedDevice.firmware ?? "unknown",
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
): GoogleDeviceId[] =>
  // Multiple control endpoints of same type would have endpoint id defined,
  // while single-endpoint device or multi-endpoint device with different types
  // would not include endpoint ID in Google device ID
  getVirtualControlDevices(homedDevice).map(device =>
    toGoogleDeviceId(clientId, device.key, device.endpointId)
  );

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
): GoogleDevice[] =>
  getVirtualControlDevices(homedDevice).map(device =>
    mapToGoogleDevice(
      homedDevice,
      clientId,
      // Flatten exposes - for single-control (not virtual) device that would be
      // all exposes, to make sure we include traits from all endpoints, for
      // virtual device it's just the single endpoint's exposes
      new Set(device.endpoints.flatMap(ep => ep.exposes)).values().toArray(),
      device.endpoints
        .map(ep => ep.options)
        .reduce(mergeDicts, {} as EndpointOptions),
      device.endpointId
    )
  );

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
  // Deduplicate exposes across endpoints for accurate trait mapping
  const allExposes = new Set(homedDevice.endpoints.flatMap(ep => ep.exposes))
    .values()
    .toArray();

  const allOptions = homedDevice.endpoints
    .map(ep => ep.options)
    .reduce(mergeDicts, {} as EndpointOptions);

  return {
    online: (deviceState.available as boolean | undefined) ?? true,
    // Get state for each supported trait - use properly typed TraitState union
    ...mapExposesToTraits(allExposes, allOptions)
      .map(trait => TRAIT_MAPPERS[trait]?.getState(deviceState))
      .reduce(mergeDicts, {}),
  };
};

/**
 * Map device state to Google state reports for all control endpoints
 * Returns an array because multi-endpoint devices need separate state reports
 *
 * @param homedDevice - Homed device (for trait info)
 * @param clientId - Unique client/service identifier
 * @param deviceState - Current device state
 * @returns Array of {googleDeviceId, googleState} tuples for state reporting
 */
export const mapToGoogleStates = (
  homedDevice: HomedDevice,
  clientId: ClientId,
  deviceState: DeviceState
): Record<GoogleDeviceId, GoogleDeviceState> =>
  getVirtualControlDevices(homedDevice)
    .map(device => {
      const { key, endpointId } = device;
      // if there's a single endpoint with a nonzero ID, use that ID for the
      // Google device, otherwise omit endpoint ID.
      // Same goes for state - extract endpoint-specific state from nested
      // structure otherwise fall back to device-level state
      const state =
        endpointId && deviceState.endpoints
          ? ((deviceState.endpoints as Record<number, DeviceState>)[
              endpointId
            ] ?? deviceState)
          : deviceState;

      const googleState = mapToGoogleState(device, state);
      const googleDeviceId = toGoogleDeviceId(clientId, key, endpointId);
      return { [googleDeviceId]: googleState };
    })
    .reduce(mergeDicts, {});

/**
 * Prepare state report for Google Home Graph
 * Compares previous and new states, returns only changed states
 * Used by handleDeviceStateChanged to determine what to report
 *
 * @param device - Homed device
 * @param clientId - Client ID
 * @param prevState - Previous device state
 * @param newState - New device state
 * @returns Record of Google device IDs to states, or null if no changes
 */
export const getStateUpdates = (
  device: HomedDevice,
  clientId: ClientId,
  prevState: DeviceState,
  newState: DeviceState
): Record<GoogleDeviceId, GoogleDeviceState> | undefined => {
  // Skip devices without traits
  if (!device.endpoints.some(ep => ep.exposes && ep.exposes.length > 0)) {
    return undefined;
  }

  // Map both states to Google format
  const prevStates = mapToGoogleStates(device, clientId, prevState);
  const newStates = mapToGoogleStates(device, clientId, newState);

  // Only return state changes - filter out unchanged states
  const stateUpdates = filterDict(
    newStates,
    (googleDeviceId, newGoogleState) =>
      !fastDeepEqual(
        newGoogleState,
        prevStates[googleDeviceId as GoogleDeviceId]
      )
  );

  // Return undefined if no changes
  return Object.keys(stateUpdates).length > 0 ? stateUpdates : undefined;
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
): CommandMessage | undefined => {
  const allExposes = new Set(homedDevice.endpoints.flatMap(ep => ep.exposes))
    .values()
    .toArray();

  const allOptions = homedDevice.endpoints
    .map(ep => ep.options)
    .reduce(mergeDicts, {});

  // Extract endpoint ID if device has been filtered to single endpoint
  // Only use endpoint ID in topic if its a truly multi-endpoint scenario
  // (endpoint ID > 0 or undefined endpoint IDs exist alongside numbered ones)
  const endpointId =
    homedDevice.endpoints.length === 1 &&
    homedDevice.endpoints[0].id &&
    homedDevice.endpoints[0].id > 0
      ? homedDevice.endpoints[0].id
      : undefined;

  // Find matching trait mapper and map command
  return mapExposesToTraits(allExposes, allOptions)
    .map(trait =>
      TRAIT_MAPPERS[trait]?.mapCommand(
        homedDevice.key,
        googleCommand,
        endpointId
      )
    )
    .find(command => command !== undefined);
};

/**
 * Map a Google execution request to Homed commands
 * Handles all mapping logic: device ID resolution, endpoint filtering, command mapping
 *
 * @param request - Execution request with Google device IDs and commands
 * @param allDevices - All devices for the user
 * @returns Array of commands ready to send to Homed devices
 */
export const mapExecutionRequest = (
  { userId, googleDeviceIds, commands }: ExecutionRequest,
  allDevices: Array<{ device: HomedDevice; clientId: ClientId }>
): CommandToSend[] =>
  // Map Google device IDs to Homed devices with context
  // Get all Google device IDs that exist for this Homed device
  allDevices.flatMap(({ device, clientId }) =>
    getGoogleDeviceIds(device, clientId)
      .filter(googleId => googleDeviceIds.includes(googleId))
      // Process each matched device
      .flatMap(googleId => {
        // For multi-endpoint devices, filter to only the requested endpoint
        const endpointId = getEndpointIdFromGoogleDeviceId(googleId);
        const deviceForCommand = {
          ...device,
          endpoints: endpointId
            ? device.endpoints.filter(ep => ep.id === endpointId)
            : device.endpoints,
        };

        // Map each Google command to Homed command
        return commands
          .map(command => mapToHomedCommand(deviceForCommand, command))
          .filter(message => message !== undefined)
          .map(message => ({
            userId,
            clientId,
            deviceId: device.key,
            endpointId,
            googleDeviceIds: [googleId],
            message,
          }));
      })
  );

/**
 * Map devices and states to Google SYNC response payload
 * Handles filtering out devices without endpoints/traits
 *
 * @param userId - User ID for the agent
 * @param devicesWithStates - Array of devices with their current states and client IDs
 * @returns SYNC response payload ready to send to Google
 */
export const mapSyncResponse = (
  userId: UserId,
  devicesWithStates: DeviceWithState[]
): SyncResponsePayload => ({
  agentUserId: userId,
  devices: devicesWithStates
    // Map all devices to Google format (may create multiple Google devices per Homed device)
    .flatMap(({ device, clientId }) => mapToGoogleDevices(device, clientId))
    // Filter out devices without traits (Google requirement)
    .filter(device => device.traits.length > 0),
});

/**
 * Map devices and states to Google QUERY response payload
 * Returns only requested device states
 *
 * @param requestedDeviceIds - Set of Google device IDs requested by Google
 * @param devicesWithStates - Array of devices with their current states and client IDs
 * @returns QUERY response payload with device states
 */
export const mapQueryResponse = (
  requestedDeviceIds: Set<GoogleDeviceId>,
  devicesWithStates: DeviceWithState[]
): QueryResponsePayload => {
  // Map Homed devices to Google device states
  const devices = devicesWithStates.reduce(
    // Use mapper to get all Google device IDs and states for this Homed device
    (acc, { device, clientId, state }) => ({
      ...acc,
      // Filter to only requested device IDs
      ...filterDict(
        mapToGoogleStates(device, clientId, state),
        googleDeviceId => requestedDeviceIds.has(googleDeviceId)
      ),
    }),
    {} as Record<GoogleDeviceId, GoogleDeviceState>
  );

  return { devices };
};
