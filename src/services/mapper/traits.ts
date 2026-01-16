/**
 * Trait mappers for converting Homed device data to/from Google Smart Home traits
 */

import type { GoogleCommand } from "../../types.ts";

/**
 * Base interface for trait mappers
 */
export interface TraitMapper {
  /**
   * Trait identifier (e.g., 'action.devices.traits.OnOff')
   */
  readonly trait: string;

  /**
   * Check if device/endpoint supports this trait
   */
  supports(exposes: string[], options?: Record<string, any>): boolean;

  /**
   * Get trait attributes for SYNC intent
   */
  getAttributes(
    exposes: string[],
    options?: Record<string, any>
  ): Record<string, any>;

  /**
   * Get current state for this trait from device data
   */
  getState(deviceData: Record<string, any>): Record<string, any> | null;

  /**
   * Convert Google command to Homed topic/message
   */
  mapCommand(
    deviceId: string,
    command: GoogleCommand
  ): { topic: string; message: any } | null;
}

/**
 * OnOff trait - controls power on/off
 */
export const OnOffTrait: TraitMapper = {
  trait: "action.devices.traits.OnOff",

  supports(exposes: string[]) {
    return exposes.some(e =>
      [
        "switch",
        "relay",
        "outlet",
        "light",
        "dimmable_light",
        "color_light",
        "lock",
      ].includes(e)
    );
  },

  getAttributes() {
    return {
      // OnOff trait doesn't require attributes
    };
  },

  getState(deviceData: Record<string, any>) {
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
    return null;
  },

  mapCommand(deviceId: string, command: GoogleCommand) {
    if (
      command.command !== "action.devices.commands.OnOff" ||
      command.params?.on === undefined
    ) {
      return null;
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
 */
export const BrightnessTrait: TraitMapper = {
  trait: "action.devices.traits.Brightness",

  supports(exposes: string[]) {
    return exposes.some(e =>
      ["dimmable_light", "color_light", "brightness"].includes(e)
    );
  },

  getAttributes() {
    return {
      // Brightness is always 0-100
    };
  },

  getState(deviceData: Record<string, any>) {
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
    return null;
  },

  mapCommand(deviceId: string, command: GoogleCommand) {
    if (
      command.command !== "action.devices.commands.BrightnessAbsolute" ||
      command.params?.brightness === undefined
    ) {
      return null;
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
 */
export const ColorSettingTrait: TraitMapper = {
  trait: "action.devices.traits.ColorSetting",

  supports(exposes: string[]) {
    return exposes.includes("color_light") || exposes.includes("color");
  },

  getAttributes(exposes: string[], options?: Record<string, any>) {
    const attributes: Record<string, any> = {
      colorModel: "rgb",
    };

    // Check if color temperature is supported
    if (exposes.includes("color_temperature") || options?.colorTemperature) {
      attributes.colorModel = "hsv";
    }

    return attributes;
  },

  getState(deviceData: Record<string, any>) {
    // RGB color format
    if (deviceData.color !== undefined) {
      const color = deviceData.color;
      if (
        typeof color === "object" &&
        (color.r !== undefined || color.x !== undefined)
      ) {
        // Already in RGB or XY format
        return { color };
      }
      if (typeof color === "string" && color.startsWith("#")) {
        // Hex format
        const hex = color.replace("#", "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return {
          color: { spectrumRgb: (r << 16) + (g << 8) + b },
        };
      }
    }

    // Color temperature format
    if (deviceData.colorTemperature !== undefined) {
      return { color: { temperatureK: Number(deviceData.colorTemperature) } };
    }

    return null;
  },

  mapCommand(deviceId: string, command: GoogleCommand) {
    if (
      command.command !== "action.devices.commands.ColorAbsolute" ||
      !command.params?.color
    ) {
      return null;
    }

    const color = command.params.color;
    const message: any = {};

    if (color.spectrumRgb !== undefined) {
      // RGB format
      const rgb = color.spectrumRgb;
      message.color = {
        r: (rgb >> 16) & 255,
        g: (rgb >> 8) & 255,
        b: rgb & 255,
      };
    } else if (color.spectrumHsv !== undefined) {
      // HSV format
      message.color = color.spectrumHsv;
    } else if (color.temperatureK !== undefined) {
      // Color temperature
      message.colorTemperature = color.temperatureK;
    }

    if (Object.keys(message).length === 0) {
      return null;
    }

    return {
      topic: `td/${deviceId}/color`,
      message,
    };
  },
};

/**
 * OpenClose trait - controls open/close state (blinds, locks, etc.)
 */
export const OpenCloseTrait: TraitMapper = {
  trait: "action.devices.traits.OpenClose",

  supports(exposes: string[]) {
    return exposes.some(e =>
      ["cover", "blinds", "curtain", "shutter"].includes(e)
    );
  },

  getAttributes() {
    return {
      discreteOnlyOpenClose: false, // Supports position control
    };
  },

  getState(deviceData: Record<string, any>) {
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

    return null;
  },

  mapCommand(deviceId: string, command: GoogleCommand) {
    if (command.command === "action.devices.commands.OpenClose") {
      const openPercent = command.params?.openPercent ?? 100;
      return {
        topic: `td/${deviceId}/position`,
        message: { position: openPercent },
      };
    }

    // Alternative: open/close only
    if (
      command.command === "action.devices.commands.OpenClose" &&
      command.params?.openPercent !== undefined
    ) {
      return {
        topic: `td/${deviceId}/cover`,
        message: {
          state: command.params.openPercent > 50 ? "open" : "closed",
        },
      };
    }

    return null;
  },
};

/**
 * TemperatureSetting trait - controls temperature setpoint
 */
export const TemperatureSettingTrait: TraitMapper = {
  trait: "action.devices.traits.TemperatureSetting",

  supports(exposes: string[]) {
    return exposes.some(e =>
      ["thermostat", "temperature_controller"].includes(e)
    );
  },

  getAttributes(exposes: string[], options?: Record<string, any>) {
    return {
      availableThermostatModes: options?.modes || ["heat", "cool", "off"],
      thermostatTemperatureUnit: "CELSIUS",
      queryOnlyTemperatureSetting: false,
    };
  },

  getState(deviceData: Record<string, any>) {
    const state: Record<string, any> = {};

    if (deviceData.temperature !== undefined) {
      state.thermostatTemperatureAmbient = Number(deviceData.temperature);
    }

    if (deviceData.setpoint !== undefined) {
      state.thermostatTemperatureSetpoint = Number(deviceData.setpoint);
    }

    if (deviceData.mode !== undefined) {
      state.thermostatMode = deviceData.mode;
    }

    return Object.keys(state).length > 0 ? state : null;
  },

  mapCommand(deviceId: string, command: GoogleCommand) {
    if (
      command.command ===
      "action.devices.commands.ThermostatTemperatureSetpoint"
    ) {
      return {
        topic: `td/${deviceId}/setpoint`,
        message: { setpoint: command.params?.thermostatTemperatureSetpoint },
      };
    }

    if (command.command === "action.devices.commands.ThermostatSetMode") {
      return {
        topic: `td/${deviceId}/mode`,
        message: { mode: command.params?.thermostatMode },
      };
    }

    return null;
  },
};

/**
 * SensorState trait - reports sensor readings
 */
export const SensorStateTrait: TraitMapper = {
  trait: "action.devices.traits.SensorState",

  supports(exposes: string[]) {
    return exposes.some(e =>
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
      ].includes(e)
    );
  },

  getAttributes(exposes: string[]) {
    const attributes: any = {};

    if (exposes.includes("occupancy") || exposes.includes("motion")) {
      attributes.sensorStatesSupported = [{ name: "occupancy" }];
    } else if (exposes.includes("contact")) {
      attributes.sensorStatesSupported = [{ name: "openclose" }];
    } else if (exposes.includes("smoke")) {
      attributes.sensorStatesSupported = [{ name: "smoke" }];
    } else if (exposes.includes("water_leak")) {
      attributes.sensorStatesSupported = [{ name: "waterleak" }];
    } else if (exposes.includes("gas")) {
      attributes.sensorStatesSupported = [{ name: "gas" }];
    } else if (
      ["co", "co2", "no2", "pm10", "pm25"].some(e => exposes.includes(e))
    ) {
      attributes.sensorStatesSupported = [{ name: "air_quality" }];
    }

    return attributes;
  },

  getState(deviceData: Record<string, any>) {
    const state: Record<string, any> = {};

    if (deviceData.occupancy !== undefined) {
      state.occupancy = deviceData.occupancy ? "OCCUPIED" : "UNOCCUPIED";
    }

    if (deviceData.motion !== undefined) {
      state.occupancy = deviceData.motion ? "OCCUPIED" : "UNOCCUPIED";
    }

    if (deviceData.contact !== undefined) {
      state.openclose = deviceData.contact ? "OPEN" : "CLOSED";
    }

    if (deviceData.smoke !== undefined) {
      state.smoke = deviceData.smoke ? "SMOKE" : "NO_SMOKE";
    }

    if (deviceData.waterLeak !== undefined) {
      state.waterleak = deviceData.waterLeak ? "LEAK" : "NO_LEAK";
    }

    if (deviceData.gas !== undefined) {
      state.gas = deviceData.gas ? "HIGH" : "NORMAL";
    }

    return Object.keys(state).length > 0 ? state : null;
  },

  mapCommand() {
    // Sensors are read-only
    return null;
  },
};

/**
 * All available trait mappers
 */
export const TRAIT_MAPPERS: TraitMapper[] = [
  OnOffTrait,
  BrightnessTrait,
  ColorSettingTrait,
  OpenCloseTrait,
  TemperatureSettingTrait,
  SensorStateTrait,
];
