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
  TAttributes extends Record<string, unknown>,
  TState extends Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TParameters,
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
   */
  mapCommand(
    deviceId: string,
    command: GoogleCommand
  ): { topic: string; message: CommandMessage } | undefined;
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
    // Look for on/off state
    if (deviceData.on !== undefined) {
      return { on: Boolean(deviceData.on) };
    }
    if (deviceData.state !== undefined) {
      return { on: Boolean(deviceData.state) };
    }
    if (deviceData.power !== undefined) {
      return { on: Boolean(deviceData.power) };
    }
    return;
  },

  mapCommand(deviceId: string, command: GoogleCommand) {
    if (command.command !== "action.devices.commands.OnOff") {
      return;
    }

    if (!isOnOffParameters(command.params)) {
      return;
    }

    const onState = command.params.on ? 1 : 0;

    return {
      topic: `td/${deviceId}/switch`,
      message: { on: onState },
    };
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
      return {
        brightness: Math.max(0, Math.min(100, Number(deviceData.level))),
      };
    }
    return;
  },

  mapCommand(deviceId: string, command: GoogleCommand) {
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

    return {
      topic: `td/${deviceId}/brightness`,
      message: { brightness },
    };
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

  mapCommand(deviceId: string, command: GoogleCommand) {
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

    return {
      topic: `td/${deviceId}/color`,
      message,
    };
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

  mapCommand(deviceId: string, command: GoogleCommand) {
    if (command.command !== "action.devices.commands.OpenClose") {
      return;
    }

    if (!isOpenCloseParameters(command.params)) {
      return;
    }

    const openPercent = command.params.openPercent ?? 100;
    return {
      topic: `td/${deviceId}/position`,
      message: { position: openPercent },
    };
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
      ["thermostat", "temperature_controller"].includes(expose)
    );
  },

  getAttributes(
    exposes: string[],
    options?: EndpointOptions
  ): TemperatureSettingAttributes {
    // Build modes array, filtering to only valid ThermostatMode values
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

    if (deviceData.temperature !== undefined) {
      state.thermostatTemperatureAmbient = Number(deviceData.temperature);
    }

    if (deviceData.setpoint !== undefined) {
      state.thermostatTemperatureSetpoint = Number(deviceData.setpoint);
    }

    if (
      deviceData.mode !== undefined && // Use isThermostatMode type guard to safely narrow type
      isThermostatMode(deviceData.mode)
    ) {
      state.thermostatMode = deviceData.mode;
    }

    return Object.keys(state).length > 0 ? state : undefined;
  },

  mapCommand(deviceId: string, command: GoogleCommand) {
    if (
      command.command ===
      "action.devices.commands.ThermostatTemperatureSetpoint"
    ) {
      if (!isTemperatureSetpointParameters(command.params)) {
        return;
      }
      return {
        topic: `td/${deviceId}/setpoint`,
        message: {
          setpoint: command.params.thermostatTemperatureSetpoint,
        },
      };
    }

    if (command.command === "action.devices.commands.ThermostatSetMode") {
      if (!isTemperatureModeParameters(command.params)) {
        return;
      }
      return {
        topic: `td/${deviceId}/mode`,
        message: { mode: command.params.thermostatMode },
      };
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
    } else if (
      ["co", "co2", "no2", "pm10", "pm25"].some(expose =>
        exposes.includes(expose)
      )
    ) {
      attributes.sensorStatesSupported.push({ name: "air_quality" });
    }

    return attributes;
  },

  getState(deviceData: DeviceState): SensorStateFlat | undefined {
    const stateObject: SensorStateFlat = {};

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

/**
 * All available trait mappers
 */
export const TRAIT_MAPPERS = [
  OnOffTrait,
  BrightnessTrait,
  ColorSettingTrait,
  OpenCloseTrait,
  TemperatureSettingTrait,
  SensorStateTrait,
];
