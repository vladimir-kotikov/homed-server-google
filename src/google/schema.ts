// Schema for incoming Google Smart Home requests and trait parameters

import { z } from "zod";
import type { GoogleDeviceId } from "./types.ts";

// ===========================================================================
// Google Commands Enum
// ===========================================================================

export const GOOGLE_COMMANDS = {
  ON_OFF: "action.devices.commands.OnOff",
  BRIGHTNESS_ABSOLUTE: "action.devices.commands.BrightnessAbsolute",
  COLOR_ABSOLUTE: "action.devices.commands.ColorAbsolute",
  OPEN_CLOSE: "action.devices.commands.OpenClose",
  THERMOSTAT_TEMPERATURE_SETPOINT:
    "action.devices.commands.ThermostatTemperatureSetpoint",
  THERMOSTAT_SET_MODE: "action.devices.commands.ThermostatSetMode",
} as const;

const OnOffParametersSchema = z.object({ on: z.boolean() }).strict();

const BrightnessParametersSchema = z
  .object({ brightness: z.number().min(0).max(100) })
  .strict();

const SpectrumRgbColorSchema = z.object({ spectrumRgb: z.number() }).strict();

const SpectrumHsvColorSchema = z
  .object({
    spectrumHsv: z
      .object({
        hue: z.number().min(0).max(360),
        saturation: z.number().min(0).max(100),
        value: z.number().min(0).max(100),
      })
      .strict(),
  })
  .strict();

const TemperatureKColorSchema = z
  .object({ temperatureK: z.number().min(1000).max(25_000) })
  .strict();

const ColorSettingParametersSchema = z
  .object({
    color: z.union([
      SpectrumRgbColorSchema,
      SpectrumHsvColorSchema,
      TemperatureKColorSchema,
    ]),
  })
  .strict();

const OpenCloseParametersSchema = z
  .object({ openPercent: z.number().min(0).max(100).optional() })
  .strict();

const ThermostatModeSchema = z.enum([
  "off",
  "heat",
  "cool",
  "auto",
  "drying",
  "eco",
  "heatCool",
]);

const TemperatureSetpointParametersSchema = z
  .object({ thermostatTemperatureSetpoint: z.number() })
  .strict();

const TemperatureModeParametersSchema = z
  .object({ thermostatMode: ThermostatModeSchema })
  .strict();

const TraitParametersSchema = z.union([
  OnOffParametersSchema,
  BrightnessParametersSchema,
  ColorSettingParametersSchema,
  OpenCloseParametersSchema,
  TemperatureSetpointParametersSchema,
  TemperatureModeParametersSchema,
]);

export type OnOffParameters = z.infer<typeof OnOffParametersSchema>;
export type BrightnessParameters = z.infer<typeof BrightnessParametersSchema>;
export type ColorSettingParameters = z.infer<
  typeof ColorSettingParametersSchema
>;
export type OpenCloseParameters = z.infer<typeof OpenCloseParametersSchema>;
export type TemperatureSetpointParameters = z.infer<
  typeof TemperatureSetpointParametersSchema
>;
export type TemperatureModeParameters = z.infer<
  typeof TemperatureModeParametersSchema
>;

// ===========================================================================
// Request Schemas
// ===========================================================================

export const QueryRequestPayloadSchema = z
  .object({ devices: z.array(z.object({ id: z.string() })) })
  .strict();

const GoogleCommandSchema = z.object({
  command: z.enum([
    GOOGLE_COMMANDS.ON_OFF,
    GOOGLE_COMMANDS.BRIGHTNESS_ABSOLUTE,
    GOOGLE_COMMANDS.COLOR_ABSOLUTE,
    GOOGLE_COMMANDS.OPEN_CLOSE,
    GOOGLE_COMMANDS.THERMOSTAT_TEMPERATURE_SETPOINT,
    GOOGLE_COMMANDS.THERMOSTAT_SET_MODE,
  ]),
  params: TraitParametersSchema.optional(),
});

export const ExecuteRequestPayloadSchema = z
  .object({
    commands: z.array(
      z.object({
        devices: z.array(z.object({ id: z.string() })),
        execution: z.array(GoogleCommandSchema).min(1),
      })
    ),
  })
  .strict();

export const SmartHomeRequestSchema = z
  .object({
    requestId: z.string(),
    inputs: z.tuple([
      z.union([
        z.object({
          intent: z.literal("action.devices.SYNC"),
        }),
        z.object({
          intent: z.literal("action.devices.QUERY"),
          payload: QueryRequestPayloadSchema,
        }),
        z.object({
          intent: z.literal("action.devices.EXECUTE"),
          payload: ExecuteRequestPayloadSchema,
        }),
        z.object({
          intent: z.literal("action.devices.DISCONNECT"),
        }),
      ]),
    ]),
  })
  .strict();

// ===========================================================================
// Type Exports
// ===========================================================================

export type QueryRequestPayload = {
  devices: Array<{ id: GoogleDeviceId }>;
};

export type ExecuteRequestPayload = {
  commands: Array<{
    devices: Array<{ id: GoogleDeviceId }>;
    execution: GoogleCommand[];
  }>;
};

export type SmartHomeRequest = z.infer<typeof SmartHomeRequestSchema>;
export type GoogleCommand = z.infer<typeof GoogleCommandSchema>;

export function isBrightnessParameters(
  parameters: unknown
): parameters is BrightnessParameters {
  return (
    typeof parameters === "object" &&
    parameters !== null &&
    "brightness" in parameters
  );
}

export function isColorSettingParameters(
  parameters: unknown
): parameters is ColorSettingParameters {
  return (
    typeof parameters === "object" &&
    parameters !== null &&
    "color" in parameters
  );
}

export function isOnOffParameters(
  parameters: unknown
): parameters is OnOffParameters {
  return (
    typeof parameters === "object" && parameters !== null && "on" in parameters
  );
}

export function isOpenCloseParameters(
  parameters: unknown
): parameters is OpenCloseParameters {
  return (
    typeof parameters === "object" &&
    parameters !== null &&
    "openPercent" in parameters
  );
}

export function isTemperatureSetpointParameters(
  parameters: unknown
): parameters is TemperatureSetpointParameters {
  return (
    typeof parameters === "object" &&
    parameters !== null &&
    "thermostatTemperatureSetpoint" in parameters
  );
}

export function isTemperatureModeParameters(
  parameters: unknown
): parameters is TemperatureModeParameters {
  return (
    typeof parameters === "object" &&
    parameters !== null &&
    "thermostatMode" in parameters
  );
}
