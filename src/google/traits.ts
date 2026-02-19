/**
 * Trait mappers for converting Homed device data to/from Google Smart Home traits
 */

import type { EndpointOptions } from "../homed/schema.ts";
import type { CommandMessage, DeviceState } from "../homed/types.ts";
import {
  type BrightnessParameters,
  type ColorSettingParameters,
  type GoogleCommand,
  type OnOffParameters,
  type OpenCloseParameters,
  type TemperatureModeParameters,
  type TemperatureSetpointParameters,
  isBrightnessParameters,
  isColorSettingParameters,
  isOnOffParameters,
  isOpenCloseParameters,
  isTemperatureModeParameters,
  isTemperatureSetpointParameters,
} from "./schema.ts";
import {
  type BrightnessAttributes,
  type BrightnessState,
  type ColorSettingAttributes,
  type ColorSettingState,
  type ColorValue,
  type NumericSensorState,
  type OnOffAttributes,
  type OnOffState,
  type OpenCloseAttributes,
  type OpenCloseState,
  type SensorStateAttributes,
  type SensorStateFlat,
  type TemperatureSettingAttributes,
  type TemperatureSettingState,
  type ThermostatMode,
  isSpectrumHsvColor,
  isSpectrumRgbColor,
  isTemperatureKColor,
  isThermostatMode,
} from "./types.ts";

/**
 * Generic trait mapper interface with type parameters for better type inference
 * @template TAttributes - Trait-specific attributes type
 * @template TState - Trait-specific state type
 * @template TParams - Trait-specific command parameters type
 */
export interface GenericTraitMapper<
  TAttributes extends Record<string, unknown> = Record<string, unknown>,
  TState extends Record<string, unknown> = Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TParameters = Record<string, unknown>,
> {
  /**
   * Trait identifier (e.g., 'action.devices.traits.OnOff')
   */
  readonly trait: string;

  /**
   * Check if device/endpoint supports this trait
   */
  supports(exposes: string[], options?: EndpointOptions): boolean;

  /**
   * Get trait attributes for SYNC intent
   */
  getAttributes(exposes: string[], options?: EndpointOptions): TAttributes;

  /**
   * Get current state for this trait from device data
   */
  getState(deviceData: DeviceState): TState | undefined;

  /**
   * Convert Google command to Homed topic/message
   * Command params must match the generic TParams type
   * @param deviceId - Base device ID (without endpoint)
   * @param command - Google command to execute
   * @param endpointId - Optional endpoint ID for multi-endpoint devices
   */
  mapCommand(
    deviceId: string,
    command: GoogleCommand,
    endpointId?: number
  ): CommandMessage | undefined;
}

/**
 * OnOff trait - controls power on/off
 * Generic implementation with concrete attribute and state types
 */
export const OnOffTrait: GenericTraitMapper<
  OnOffAttributes,
  OnOffState,
  OnOffParameters
> = {
  trait: "action.devices.traits.OnOff",

  supports(exposes: string[]) {
    return exposes.some(expose =>
      [
        "switch",
        "relay",
        "outlet",
        "light",
        "dimmable_light",
        "color_light",
        "lock",
      ].includes(expose)
    );
  },

  getAttributes(): OnOffAttributes {
    // OnOff trait doesn't require attributes
    return {};
  },

  getState(deviceData: DeviceState): OnOffState | undefined {
    // Look for on/off state - check multiple possible property names
    if (deviceData.on !== undefined) {
      return { on: Boolean(deviceData.on) };
    }
    if (deviceData.status !== undefined) {
      // Handle both boolean and string values
      const status = deviceData.status;
      return {
        on: typeof status === "string" ? status === "on" : Boolean(status),
      };
    }
    if (deviceData.state !== undefined) {
      // Handle both boolean and string values
      const state = deviceData.state;
      return {
        on: typeof state === "string" ? state === "on" : Boolean(state),
      };
    }
    if (deviceData.power !== undefined) {
      return { on: Boolean(deviceData.power) };
    }
    return;
  },

  mapCommand(deviceId: string, command: GoogleCommand, _endpointId?: number) {
    if (command.command !== "action.devices.commands.OnOff") {
      return;
    }

    if (!isOnOffParameters(command.params)) {
      return;
    }

    const status = command.params.on ? "on" : "off";

    return { status };
  },
};

/**
 * Brightness trait - controls light brightness (0-100)
 * Generic implementation with concrete attribute and state types
 */
export const BrightnessTrait: GenericTraitMapper<
  BrightnessAttributes,
  BrightnessState,
  BrightnessParameters
> = {
  trait: "action.devices.traits.Brightness",

  supports(exposes: string[]) {
    return exposes.some(expose =>
      ["dimmable_light", "color_light", "brightness"].includes(expose)
    );
  },

  getAttributes(): BrightnessAttributes {
    // Brightness is always 0-100
    return {};
  },

  getState(deviceData: DeviceState): BrightnessState | undefined {
    if (deviceData.brightness !== undefined) {
      return {
        brightness: Math.max(0, Math.min(100, Number(deviceData.brightness))),
      };
    }
    if (deviceData.level !== undefined) {
      // Homed sends level in 0-255 range, convert to 0-100 for Google
      const level = Number(deviceData.level);
      return {
        brightness: Math.round(Math.max(0, Math.min(255, level)) * (100 / 255)),
      };
    }
    return;
  },

  mapCommand(deviceId: string, command: GoogleCommand, _endpointId?: number) {
    if (command.command !== "action.devices.commands.BrightnessAbsolute") {
      return;
    }

    if (!isBrightnessParameters(command.params)) {
      return;
    }

    const brightness = Math.max(
      0,
      Math.min(100, Number(command.params.brightness))
    );

    // Convert Google's 0-100% to Homed's 0-255 range
    const level = Math.round((brightness * 255) / 100);

    return { level };
  },
};

/**
 * ColorSetting trait - controls light color
 * Generic implementation with concrete attribute and state types
 */
export const ColorSettingTrait: GenericTraitMapper<
  ColorSettingAttributes,
  ColorSettingState,
  ColorSettingParameters
> = {
  trait: "action.devices.traits.ColorSetting",

  supports(exposes: string[]) {
    return exposes.includes("color_light") || exposes.includes("color");
  },

  getAttributes(
    exposes: string[],
    options?: EndpointOptions
  ): ColorSettingAttributes {
    const attributes: ColorSettingAttributes = {
      colorModel: "rgb",
    };

    // Check if color temperature is supported
    if (exposes.includes("color_temperature") || options?.colorTemperature) {
      attributes.colorModel = "hsv";
    }

    return attributes;
  },

  getState(deviceData: DeviceState): ColorSettingState | undefined {
    // RGB color format
    if (deviceData.color !== undefined) {
      const color = deviceData.color;
      if (
        typeof color === "object" &&
        color !== null &&
        ("r" in color || "x" in color)
      ) {
        // Device data is from Homed protocol which guarantees color objects have either 'r' or 'x' properties.
        // After the above checks, we safely treat it as a ColorValue (RgbColor | XyColor) union member.
        return {
          color: color as unknown as ColorValue,
        };
      }
      if (typeof color === "string" && color.startsWith("#")) {
        // Hex format
        const hex = color.replace("#", "");
        const r = Number.parseInt(hex.slice(0, 2), 16);
        const g = Number.parseInt(hex.slice(2, 4), 16);
        const b = Number.parseInt(hex.slice(4, 6), 16);
        return {
          color: { spectrumRgb: (r << 16) + (g << 8) + b },
        };
      }
    }

    // Color temperature format
    if (deviceData.colorTemperature !== undefined) {
      return {
        color: { temperatureK: Number(deviceData.colorTemperature) },
      };
    }

    return;
  },

  mapCommand(deviceId: string, command: GoogleCommand, _endpointId?: number) {
    if (command.command !== "action.devices.commands.ColorAbsolute") {
      return;
    }

    if (!isColorSettingParameters(command.params)) {
      return;
    }

    const color = command.params.color;
    const message: Record<string, unknown> = {};

    // Use type discriminators instead of casting
    if (isSpectrumRgbColor(color)) {
      const rgb = color.spectrumRgb;
      message.color = {
        r: (rgb >> 16) & 255,
        g: (rgb >> 8) & 255,
        b: rgb & 255,
      };
    } else if (isSpectrumHsvColor(color)) {
      message.color = color.spectrumHsv;
    } else if (isTemperatureKColor(color)) {
      message.colorTemperature = color.temperatureK;
    }

    if (Object.keys(message).length === 0) {
      return;
    }

    return message;
  },
};

/**
 * OpenClose trait - controls open/close state (blinds, locks, etc.)
 * Generic implementation with concrete attribute and state types
 */
export const OpenCloseTrait: GenericTraitMapper<
  OpenCloseAttributes,
  OpenCloseState,
  OpenCloseParameters
> = {
  trait: "action.devices.traits.OpenClose",

  supports(exposes: string[]) {
    return exposes.some(expose =>
      ["cover", "blinds", "curtain", "shutter"].includes(expose)
    );
  },

  getAttributes(): OpenCloseAttributes {
    return {
      discreteOnlyOpenClose: false, // Supports position control
    };
  },

  getState(deviceData: DeviceState): OpenCloseState | undefined {
    if (deviceData.position !== undefined) {
      const position = Math.max(0, Math.min(100, Number(deviceData.position)));
      return {
        openPercent: position,
      };
    }

    if (deviceData.state !== undefined) {
      const state = deviceData.state;
      if (typeof state === "string") {
        return {
          openPercent: state === "open" ? 100 : state === "closed" ? 0 : 50,
        };
      }
    }

    return;
  },

  mapCommand(deviceId: string, command: GoogleCommand, _endpointId?: number) {
    if (command.command !== "action.devices.commands.OpenClose") {
      return;
    }

    if (!isOpenCloseParameters(command.params)) {
      return;
    }

    const openPercent = command.params.openPercent ?? 100;

    return { position: openPercent };
  },
};

/**
 * TemperatureSetting trait - controls temperature setpoint
 * Generic implementation with concrete attribute and state types
 */
export const TemperatureSettingTrait: GenericTraitMapper<
  TemperatureSettingAttributes,
  TemperatureSettingState,
  TemperatureSetpointParameters | TemperatureModeParameters
> = {
  trait: "action.devices.traits.TemperatureSetting",

  supports(exposes: string[]) {
    return exposes.some(expose =>
      [
        "thermostat",
        "temperature_controller",
        "temperature",
        "humidity",
      ].includes(expose)
    );
  },

  getAttributes(
    exposes: string[],
    options?: EndpointOptions
  ): TemperatureSettingAttributes {
    // Check if this is a controllable thermostat or a read-only sensor
    const isControllable = exposes.some(expose =>
      ["thermostat", "temperature_controller"].includes(expose)
    );

    // For read-only sensors, set queryOnlyTemperatureSetting: true
    if (!isControllable) {
      return {
        availableThermostatModes: ["off"],
        thermostatTemperatureUnit: "CELSIUS",
        queryOnlyTemperatureSetting: true,
      };
    }

    // Build modes array for controllable thermostats
    const modes: ThermostatMode[] = [];
    if (options?.modes && Array.isArray(options.modes)) {
      // Type guard: only include valid thermostat modes from options
      for (const mode of options.modes) {
        if (
          typeof mode === "string" &&
          ["off", "heat", "cool", "auto", "drying", "eco", "heatCool"].includes(
            mode
          )
        ) {
          modes.push(mode as ThermostatMode);
        }
      }
    }

    // If no valid modes found, use defaults
    if (modes.length === 0) {
      modes.push("heat", "cool", "off");
    }

    return {
      availableThermostatModes: modes,
      thermostatTemperatureUnit: "CELSIUS",
      queryOnlyTemperatureSetting: false,
    };
  },

  getState(deviceData: DeviceState): TemperatureSettingState | undefined {
    const state: TemperatureSettingState = {};

    if (
      deviceData.temperature !== undefined &&
      deviceData.temperature !== null
    ) {
      const temp = Number(deviceData.temperature);
      if (!isNaN(temp)) {
        state.thermostatTemperatureAmbient = temp;
      }
    }

    // Report humidity via thermostatHumidityAmbient for sensors
    if (deviceData.humidity !== undefined && deviceData.humidity !== null) {
      const humidity = Number(deviceData.humidity);
      if (!isNaN(humidity)) {
        state.thermostatHumidityAmbient = humidity;
      }
    }

    if (deviceData.setpoint !== undefined && deviceData.setpoint !== null) {
      const setpoint = Number(deviceData.setpoint);
      if (!isNaN(setpoint)) {
        state.thermostatTemperatureSetpoint = setpoint;
      }
    }

    if (
      deviceData.mode !== undefined && // Use isThermostatMode type guard to safely narrow type
      isThermostatMode(deviceData.mode)
    ) {
      state.thermostatMode = deviceData.mode;
    }

    return Object.keys(state).length > 0 ? state : undefined;
  },

  mapCommand(deviceId: string, command: GoogleCommand, _endpointId?: number) {
    if (
      command.command ===
      "action.devices.commands.ThermostatTemperatureSetpoint"
    ) {
      if (!isTemperatureSetpointParameters(command.params)) {
        return;
      }
      return {
        setpoint: command.params.thermostatTemperatureSetpoint,
      };
    }

    if (command.command === "action.devices.commands.ThermostatSetMode") {
      if (!isTemperatureModeParameters(command.params)) {
        return;
      }
      return { mode: command.params.thermostatMode };
    }

    return;
  },
};

/**
 * SensorState trait - reports sensor readings
 * Generic implementation with concrete attribute and state types
 * Note: TParams is never (read-only, no commands accepted)
 */
export const SensorStateTrait: GenericTraitMapper<
  SensorStateAttributes,
  SensorStateFlat,
  never
> = {
  trait: "action.devices.traits.SensorState",

  supports(exposes: string[]) {
    return exposes.some(expose =>
      [
        "occupancy",
        "motion",
        "contact",
        "smoke",
        "water_leak",
        "gas",
        "co",
        "co2",
        "no2",
        "pm10",
        "pm25",
        "temperature",
        "humidity",
        "pressure",
      ].includes(expose)
    );
  },

  getAttributes(exposes: string[]): SensorStateAttributes {
    const attributes: SensorStateAttributes = {
      sensorStatesSupported: [],
    };

    if (exposes.includes("occupancy") || exposes.includes("motion")) {
      attributes.sensorStatesSupported.push({ name: "occupancy" });
    } else if (exposes.includes("contact")) {
      attributes.sensorStatesSupported.push({ name: "openclose" });
    } else if (exposes.includes("smoke")) {
      attributes.sensorStatesSupported.push({ name: "smoke" });
    } else if (exposes.includes("water_leak")) {
      attributes.sensorStatesSupported.push({ name: "waterleak" });
    } else if (exposes.includes("gas")) {
      attributes.sensorStatesSupported.push({ name: "gas" });
    }

    if (exposes.includes("temperature")) {
      attributes.sensorStatesSupported.push({
        name: "AmbientTemperature",
        numericCapabilities: {
          rawValueUnit: "DEGREES_CELSIUS",
        },
      });
    }

    if (exposes.includes("humidity")) {
      attributes.sensorStatesSupported.push({
        name: "AmbientHumidity",
        numericCapabilities: {
          rawValueUnit: "PERCENT",
        },
      });
    }

    if (exposes.includes("pressure")) {
      attributes.sensorStatesSupported.push({
        name: "AirPressure",
        numericCapabilities: {
          rawValueUnit: "PASCALS",
        },
      });
    }

    if (exposes.includes("co2")) {
      attributes.sensorStatesSupported.push({
        name: "CarbonDioxideLevel",
        numericCapabilities: {
          rawValueUnit: "PARTS_PER_MILLION",
        },
      });
    }

    if (exposes.includes("co")) {
      attributes.sensorStatesSupported.push({
        name: "CarbonMonoxideLevel",
        numericCapabilities: {
          rawValueUnit: "PARTS_PER_MILLION",
        },
      });
    }

    if (exposes.includes("pm25")) {
      attributes.sensorStatesSupported.push({
        name: "PM2.5",
        numericCapabilities: {
          rawValueUnit: "MICROGRAMS_PER_CUBIC_METER",
        },
      });
    }

    if (exposes.includes("pm10")) {
      attributes.sensorStatesSupported.push({
        name: "PM10",
        numericCapabilities: {
          rawValueUnit: "MICROGRAMS_PER_CUBIC_METER",
        },
      });
    }

    return attributes;
  },

  getState(deviceData: DeviceState): SensorStateFlat | undefined {
    const stateObject: SensorStateFlat = {};
    const numericData: NumericSensorState[] = [];

    if (deviceData.occupancy !== undefined) {
      stateObject.occupancy = deviceData.occupancy ? "OCCUPIED" : "UNOCCUPIED";
    }

    if (deviceData.motion !== undefined) {
      stateObject.occupancy = deviceData.motion ? "OCCUPIED" : "UNOCCUPIED";
    }

    if (deviceData.contact !== undefined) {
      stateObject.openclose = deviceData.contact ? "OPEN" : "CLOSED";
    }

    if (deviceData.smoke !== undefined) {
      stateObject.smoke = deviceData.smoke ? "SMOKE" : "NO_SMOKE";
    }

    if (deviceData.waterLeak !== undefined) {
      stateObject.waterleak = deviceData.waterLeak ? "LEAK" : "NO_LEAK";
    }

    if (deviceData.gas !== undefined) {
      stateObject.gas = deviceData.gas ? "HIGH" : "NORMAL";
    }

    if (
      deviceData.temperature !== undefined &&
      deviceData.temperature !== null
    ) {
      const temp = Number(deviceData.temperature);
      if (!isNaN(temp)) {
        numericData.push({
          name: "AmbientTemperature",
          rawValue: temp,
        });
      }
    }

    if (deviceData.humidity !== undefined && deviceData.humidity !== null) {
      const humidity = Number(deviceData.humidity);
      if (!isNaN(humidity)) {
        numericData.push({
          name: "AmbientHumidity",
          rawValue: humidity,
        });
      }
    }

    if (deviceData.pressure !== undefined && deviceData.pressure !== null) {
      const pressure = Number(deviceData.pressure);
      if (!isNaN(pressure)) {
        numericData.push({
          name: "AirPressure",
          rawValue: pressure,
        });
      }
    }

    if (deviceData.co2 !== undefined && deviceData.co2 !== null) {
      const co2 = Number(deviceData.co2);
      if (!isNaN(co2)) {
        numericData.push({
          name: "CarbonDioxideLevel",
          rawValue: co2,
        });
      }
    }

    if (deviceData.co !== undefined && deviceData.co !== null) {
      const co = Number(deviceData.co);
      if (!isNaN(co)) {
        numericData.push({
          name: "CarbonMonoxideLevel",
          rawValue: co,
        });
      }
    }

    if (deviceData.pm25 !== undefined && deviceData.pm25 !== null) {
      const pm25 = Number(deviceData.pm25);
      if (!isNaN(pm25)) {
        numericData.push({
          name: "PM2.5",
          rawValue: pm25,
        });
      }
    }

    if (deviceData.pm10 !== undefined && deviceData.pm10 !== null) {
      const pm10 = Number(deviceData.pm10);
      if (!isNaN(pm10)) {
        numericData.push({
          name: "PM10",
          rawValue: pm10,
        });
      }
    }

    if (numericData.length > 0) {
      stateObject.currentSensorStateData = numericData;
    }

    if (Object.keys(stateObject).length > 0) {
      return stateObject;
    }

    return;
  },

  mapCommand(): undefined {
    // Sensors are read-only
    return;
  },
};

/**
 * Google Smart Home trait names
 */
export const GOOGLE_TRAITS = {
  ON_OFF: "action.devices.traits.OnOff",
  BRIGHTNESS: "action.devices.traits.Brightness",
  COLOR_SETTING: "action.devices.traits.ColorSetting",
  OPEN_CLOSE: "action.devices.traits.OpenClose",
  TEMPERATURE_SETTING: "action.devices.traits.TemperatureSetting",
  SENSOR_STATE: "action.devices.traits.SensorState",
} as const;

export const TRAIT_MAPPERS: Record<string, GenericTraitMapper> = {
  "action.devices.traits.OnOff": OnOffTrait,
  "action.devices.traits.Brightness": BrightnessTrait,
  "action.devices.traits.ColorSetting": ColorSettingTrait,
  "action.devices.traits.OpenClose": OpenCloseTrait,
  "action.devices.traits.TemperatureSetting": TemperatureSettingTrait,
  "action.devices.traits.SensorState": SensorStateTrait,
};
