/**
 * Google Smart Home Request/Response/Trait Schemas using Zod
 *
 * These schemas validate trait attributes, states, and parameters
 * for the Google Smart Home integration.
 */

import { z } from "zod";

// ===========================================================================
// OnOff Trait
// ===========================================================================

export const OnOffAttributesSchema = z.object({}).strict();

export const OnOffStateSchema = z
  .object({
    on: z.boolean(),
  })
  .strict();

export const OnOffParametersSchema = z
  .object({
    on: z.boolean(),
  })
  .strict();

// ===========================================================================
// Brightness Trait
// ===========================================================================

export const BrightnessAttributesSchema = z.object({}).strict();

export const BrightnessStateSchema = z
  .object({
    brightness: z.number().min(0).max(100),
  })
  .strict();

export const BrightnessParametersSchema = z
  .object({
    brightness: z.number().min(0).max(100),
  })
  .strict();

// ===========================================================================
// ColorSetting Trait
// ===========================================================================

export const ColorSettingAttributesSchema = z
  .object({
    colorModel: z.enum(["rgb", "hsv"]).optional(),
  })
  .strict();

export const SpectrumRgbColorSchema = z
  .object({
    spectrumRgb: z.number(),
  })
  .strict();

export const SpectrumHsvColorSchema = z
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

export const TemperatureKColorSchema = z
  .object({
    temperatureK: z.number().min(1000).max(25_000),
  })
  .strict();

export const ColorValueSchema = z.union([
  SpectrumRgbColorSchema,
  SpectrumHsvColorSchema,
  TemperatureKColorSchema,
]);

export const ColorSettingStateSchema = z
  .object({
    color: ColorValueSchema,
  })
  .strict();

export const ColorSettingParametersSchema = z
  .object({
    color: ColorValueSchema,
  })
  .strict();

// ===========================================================================
// OpenClose Trait
// ===========================================================================

export const OpenCloseAttributesSchema = z
  .object({
    discreteOnlyOpenClose: z.boolean().optional(),
  })
  .strict();

export const OpenCloseStateSchema = z
  .object({
    openPercent: z.number().min(0).max(100),
  })
  .strict();

export const OpenCloseParametersSchema = z
  .object({
    openPercent: z.number().min(0).max(100).optional(),
  })
  .strict();

// ===========================================================================
// TemperatureSetting Trait
// ===========================================================================

export const ThermostatModeSchema = z.enum([
  "off",
  "heat",
  "cool",
  "auto",
  "drying",
  "eco",
  "heatCool",
]);

export const TemperatureSettingAttributesSchema = z
  .object({
    availableThermostatModes: z.array(ThermostatModeSchema),
    thermostatTemperatureUnit: z.enum(["CELSIUS", "FAHRENHEIT"]),
    queryOnlyTemperatureSetting: z.boolean().optional(),
    thermostatTemperatureRange: z
      .object({
        minThresholdCelsius: z.number(),
        maxThresholdCelsius: z.number(),
      })
      .optional(),
    hoverTemperatureRange: z
      .object({
        minThresholdCelsius: z.number(),
        maxThresholdCelsius: z.number(),
      })
      .optional(),
    bufferRangeCelsius: z.number().optional(),
  })
  .strict();

export const TemperatureSettingStateSchema = z
  .object({
    thermostatTemperatureAmbient: z.number().optional(),
    thermostatTemperatureSetpoint: z.number().optional(),
    thermostatMode: ThermostatModeSchema.optional(),
    thermostatHumidityAmbient: z.number().optional(),
  })
  .strict();

export const TemperatureSetpointParametersSchema = z
  .object({
    thermostatTemperatureSetpoint: z.number(),
  })
  .strict();

export const TemperatureModeParametersSchema = z
  .object({
    thermostatMode: ThermostatModeSchema,
  })
  .strict();

// ===========================================================================
// SensorState Trait
// ===========================================================================

export const SensorNameSchema = z.enum([
  "occupancy",
  "openclose",
  "smoke",
  "waterleak",
  "gas",
  "filter_cleanliness",
  "filter_life_time",
  "air_quality",
]);

export const SensorStateSupportedSchema = z
  .object({
    name: SensorNameSchema,
  })
  .strict();

export const SensorStateAttributesSchema = z
  .object({
    sensorStatesSupported: z.array(SensorStateSupportedSchema),
  })
  .strict();

export const OccupancyStateSchema = z.enum(["OCCUPIED", "UNOCCUPIED"]);
export const OpenCloseContactStateSchema = z.enum(["OPEN", "CLOSED"]);
export const SmokeStateSchema = z.enum(["SMOKE", "NO_SMOKE"]);
export const WaterLeakStateSchema = z.enum(["LEAK", "NO_LEAK"]);
export const GasStateSchema = z.enum(["HIGH", "NORMAL"]);
export const FilterCleanlinessStateSchema = z.enum([
  "CLEAN",
  "SLIGHTLY_DIRTY",
  "VERY_DIRTY",
]);
export const AirQualitySchema = z.enum([
  "EXCELLENT",
  "GOOD",
  "FAIR",
  "POOR",
  "VERY_POOR",
]);

export const SensorStateFlatSchema = z
  .object({
    occupancy: OccupancyStateSchema.optional(),
    openclose: OpenCloseContactStateSchema.optional(),
    smoke: SmokeStateSchema.optional(),
    waterleak: WaterLeakStateSchema.optional(),
    gas: GasStateSchema.optional(),
    filter_cleanliness: FilterCleanlinessStateSchema.optional(),
    filter_life_time: z.number().min(0).max(100).optional(),
    air_quality: AirQualitySchema.optional(),
  })
  .strict();

export const SensorStateValueSchema = SensorStateFlatSchema;

export const SensorStateSchema = z
  .object({
    sensorStates: z.array(SensorStateValueSchema),
  })
  .strict();

// ===========================================================================
// Union Types for Validation
// ===========================================================================

export const TraitAttributesSchema = z.union([
  OnOffAttributesSchema,
  BrightnessAttributesSchema,
  ColorSettingAttributesSchema,
  OpenCloseAttributesSchema,
  TemperatureSettingAttributesSchema,
  SensorStateAttributesSchema,
]);

export const TraitStateSchema = z.union([
  OnOffStateSchema,
  BrightnessStateSchema,
  ColorSettingStateSchema,
  OpenCloseStateSchema,
  TemperatureSettingStateSchema,
  SensorStateSchema,
]);

export const TraitParametersSchema = z.union([
  OnOffParametersSchema,
  BrightnessParametersSchema,
  ColorSettingParametersSchema,
  OpenCloseParametersSchema,
  TemperatureSetpointParametersSchema,
  TemperatureModeParametersSchema,
]);

// ===========================================================================
// Type Exports
// ===========================================================================

export type OnOffAttributes = z.infer<typeof OnOffAttributesSchema>;
export type OnOffState = z.infer<typeof OnOffStateSchema>;
export type OnOffParameters = z.infer<typeof OnOffParametersSchema>;

export type BrightnessAttributes = z.infer<typeof BrightnessAttributesSchema>;
export type BrightnessState = z.infer<typeof BrightnessStateSchema>;
export type BrightnessParameters = z.infer<typeof BrightnessParametersSchema>;
export type ColorSettingAttributes = z.infer<
  typeof ColorSettingAttributesSchema
>;
export type ColorSettingState = z.infer<typeof ColorSettingStateSchema>;
export type ColorSettingParameters = z.infer<
  typeof ColorSettingParametersSchema
>;

export type OpenCloseAttributes = z.infer<typeof OpenCloseAttributesSchema>;
export type OpenCloseState = z.infer<typeof OpenCloseStateSchema>;
export type OpenCloseParameters = z.infer<typeof OpenCloseParametersSchema>;
export type TemperatureSettingAttributes = z.infer<
  typeof TemperatureSettingAttributesSchema
>;
export type TemperatureSettingState = z.infer<
  typeof TemperatureSettingStateSchema
>;
export type TemperatureSetpointParameters = z.infer<
  typeof TemperatureSetpointParametersSchema
>;
export type TemperatureModeParameters = z.infer<
  typeof TemperatureModeParametersSchema
>;

export type SensorStateAttributes = z.infer<typeof SensorStateAttributesSchema>;
export type SensorStateFlat = z.infer<typeof SensorStateFlatSchema>;
export type SensorState = z.infer<typeof SensorStateSchema>;

export type TraitAttributes = z.infer<typeof TraitAttributesSchema>;
export type TraitState = z.infer<typeof TraitStateSchema>;
export type TraitParameters = z.infer<typeof TraitParametersSchema>;

export type ThermostatMode = z.infer<typeof ThermostatModeSchema>;
export type ColorValue = z.infer<typeof ColorValueSchema>;

// ===========================================================================
// Intent Enum
// ===========================================================================

export const IntentSchema = z.enum([
  "action.devices.SYNC",
  "action.devices.QUERY",
  "action.devices.EXECUTE",
  "action.devices.DISCONNECT",
]);

export type Intent = z.infer<typeof IntentSchema>;

// ===========================================================================
// Request Schemas
// ===========================================================================

export const SyncRequestSchema = z
  .object({
    requestId: z.string(),
    inputs: z.tuple([
      z.object({
        intent: z.literal("action.devices.SYNC"),
      }),
    ]),
  })
  .strict();

export const QueryRequestSchema = z
  .object({
    requestId: z.string(),
    inputs: z.tuple([
      z.object({
        intent: z.literal("action.devices.QUERY"),
        payload: z.object({
          devices: z.array(z.object({ id: z.string() })),
        }),
      }),
    ]),
  })
  .strict();

export const ExecuteRequestSchema = z
  .object({
    requestId: z.string(),
    inputs: z.tuple([
      z.object({
        intent: z.literal("action.devices.EXECUTE"),
        payload: z.object({
          commands: z.array(
            z.object({
              devices: z.array(z.object({ id: z.string() })),
              execution: z
                .array(
                  z.object({
                    command: z.string(),
                    params: TraitParametersSchema.optional(),
                  })
                )
                .min(1),
            })
          ),
        }),
      }),
    ]),
  })
  .strict();

export const DisconnectRequestSchema = z
  .object({
    requestId: z.string(),
    inputs: z.tuple([
      z.object({
        intent: z.literal("action.devices.DISCONNECT"),
      }),
    ]),
  })
  .strict();

export const SmartHomeRequestSchema = z.union([
  SyncRequestSchema,
  QueryRequestSchema,
  ExecuteRequestSchema,
  DisconnectRequestSchema,
]);

// ===========================================================================
// Type Exports
// ===========================================================================

export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type QueryRequest = z.infer<typeof QueryRequestSchema>;
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;
export type DisconnectRequest = z.infer<typeof DisconnectRequestSchema>;
export type SmartHomeRequest = z.infer<typeof SmartHomeRequestSchema>;
