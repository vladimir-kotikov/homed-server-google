/**
 * Device State Schemas using Zod
 *
 * These schemas validate device state data from the Homed TCP protocol.
 * Uses discriminated unions for type-safe parsing of 15+ device state variants.
 *
 * Generated from: src/types/device-state.ts
 */

import { z } from "zod";

// ============================================================================
// Color Schemas
// ============================================================================

export const RgbColorSchema = z
  .object({
    r: z.number().min(0).max(255),
    g: z.number().min(0).max(255),
    b: z.number().min(0).max(255),
  })
  .strict();

export const XyColorSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

export const HsColorSchema = z
  .object({
    hue: z.number(),
    saturation: z.number(),
  })
  .strict();

export const ColorValueSchema = z.union([
  z.string().regex(/^#[0-9A-Fa-f]{6}$/), // Hex color
  RgbColorSchema,
  XyColorSchema,
  HsColorSchema,
]);

// ============================================================================
// Base Schema
// ============================================================================

export const BaseDeviceStateSchema = z
  .object({
    status: z.enum(["online", "offline", "on", "off"]).optional(),
    linkQuality: z.number().min(0).max(255).optional(),
    battery: z.number().min(0).max(100).optional(),
    batteryLow: z.boolean().optional(),
    tamper: z.boolean().optional(),
    messageCount: z.number().optional(),
  })
  .strict()
  .passthrough(); // Allow additional unknown properties

// ============================================================================
// Discriminated Union: Device States
// ============================================================================

/**
 * OnOff state
 */
const OnOffStateSchema = z
  .object({
    on: z.union([z.boolean(), z.number().min(0).max(1)]).optional(),
    state: z
      .union([z.boolean(), z.number().min(0).max(1), z.enum(["on", "off"])])
      .optional(),
    power: z.union([z.boolean(), z.number()]).optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Brightness state (extends OnOff)
 */
const BrightnessStateSchema = OnOffStateSchema.merge(
  z.object({
    brightness: z.number().min(0).max(100).optional(),
    level: z.number().min(0).max(100).optional(),
  })
);

/**
 * Color state (extends Brightness)
 */
const ColorStateSchema = BrightnessStateSchema.merge(
  z.object({
    color: ColorValueSchema.optional(),
    colorTemperature: z.number().optional(),
    colorMode: z
      .union([z.boolean(), z.enum(["rgb", "xy", "hs", "ct"])])
      .optional(),
  })
);

/**
 * Cover/Blind state
 */
const CoverStateSchema = z
  .object({
    position: z.number().min(0).max(100).optional(),
    cover: z.enum(["open", "closed", "stop"]).optional(),
    moving: z.union([z.number(), z.boolean()]).optional(),
    tilt: z.number().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Lock state
 */
const LockStateSchema = z
  .object({
    status: z
      .enum(["on", "off", "locked", "unlocked", "online", "offline"])
      .optional(),
    lock: z.enum(["on", "off", "locked", "unlocked"]).optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Thermostat state
 */
const ThermostatStateSchema = z
  .object({
    setpoint: z.number().optional(),
    targetTemperature: z.number().optional(),
    temperature: z.number().optional(),
    systemMode: z.enum(["off", "heat", "cool", "auto", "fan"]).optional(),
    mode: z.string().optional(),
    operationMode: z.string().optional(),
    fanMode: z.string().optional(),
    running: z.boolean().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Temperature sensor state
 */
const TemperatureSensorStateSchema = z
  .object({
    temperature: z.number().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Humidity sensor state
 */
const HumiditySensorStateSchema = z
  .object({
    humidity: z.number().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Contact sensor state
 */
const ContactSensorStateSchema = z
  .object({
    contact: z.boolean().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Occupancy/Motion sensor state
 */
const OccupancySensorStateSchema = z
  .object({
    occupancy: z.boolean().optional(),
    motion: z.boolean().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Smoke detector state
 */
const SmokeSensorStateSchema = z
  .object({
    smoke: z.boolean().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Water leak sensor state
 */
const WaterLeakSensorStateSchema = z
  .object({
    waterLeak: z.boolean().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Gas sensor state
 */
const GasSensorStateSchema = z
  .object({
    gas: z.boolean().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Multi-sensor state
 */
const MultiSensorStateSchema = z
  .object({
    temperature: z.number().optional(),
    humidity: z.number().optional(),
    pressure: z.number().optional(),
    illuminance: z.number().optional(),
    co2: z.number().optional(),
    voc: z.number().optional(),
    pm25: z.number().optional(),
    pm10: z.number().optional(),
  })
  .merge(BaseDeviceStateSchema);

/**
 * Trigger sensor state (action/event/scene)
 */
const TriggerSensorStateSchema = z
  .object({
    action: z.string().optional(),
    event: z.string().optional(),
    scene: z.string().optional(),
  })
  .merge(BaseDeviceStateSchema);

// ============================================================================
// Main Discriminated Union
// ============================================================================

/**
 * Main DeviceState schema using discriminated union
 * Enables efficient type narrowing and validation
 */
export const DeviceStateSchema = z.union([
  OnOffStateSchema,
  BrightnessStateSchema,
  ColorStateSchema,
  CoverStateSchema,
  LockStateSchema,
  ThermostatStateSchema,
  TemperatureSensorStateSchema,
  HumiditySensorStateSchema,
  ContactSensorStateSchema,
  OccupancySensorStateSchema,
  SmokeSensorStateSchema,
  WaterLeakSensorStateSchema,
  GasSensorStateSchema,
  MultiSensorStateSchema,
  TriggerSensorStateSchema,
  BaseDeviceStateSchema, // Catch-all
]);

/**
 * Command message (partial device state)
 * Since DeviceState is a union, we allow any object
 */
export const CommandMessageSchema = z.object({}).passthrough();

// ============================================================================
// Type Exports
// ============================================================================

export type DeviceStateType = z.infer<typeof DeviceStateSchema>;
export type CommandMessageType = z.infer<typeof CommandMessageSchema>;
export type RgbColor = z.infer<typeof RgbColorSchema>;
export type XyColor = z.infer<typeof XyColorSchema>;
export type HsColor = z.infer<typeof HsColorSchema>;
export type ColorValue = z.infer<typeof ColorValueSchema>;
