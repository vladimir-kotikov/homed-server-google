/**
 * Protocol Message Type Definitions
 *
 * These types define the structure of messages sent over the Homed TCP protocol.
 * Based on analysis of:
 * - homed-service-cloud C++ controller implementation
 * - homed-server-cloud C++ server implementation
 * - Test data and actual usage patterns
 */

/**
 * Device State Type Definitions
 *
 * These types define the structure of device state data as received from
 * the Homed TCP protocol. Based on analysis of:
 * - homed-service-common C++ code (endpoint.h, expose.h, color.h)
 * - Test data from mapper.test.ts and mqtt.test.ts
 * - Actual usage patterns in device.service.ts
 */

/**
 * RGB color representation (values 0-255)
 */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * XY color representation (CIE color space)
 */
export interface XyColor {
  x: number;
  y: number;
}

/**
 * HS color representation (Hue/Saturation)
 */
export interface HsColor {
  hue: number;
  saturation: number;
}

/**
 * Color value can be:
 * - Hex string (#RRGGBB)
 * - RGB object
 * - XY object
 * - HS object
 */
export type ColorValue = string | RgbColor | XyColor | HsColor;

/**
 * Base properties common to all device states
 */
export interface BaseDeviceState {
  /** Device online/availability status */
  status?: "online" | "offline" | "on" | "off";
  /** Link quality (0-255) */
  linkQuality?: number;
  /** Battery percentage (0-100) */
  battery?: number;
  /** Battery low warning */
  batteryLow?: boolean;
  /** Tamper detection */
  tamper?: boolean;
  /** Message count */
  messageCount?: number;
  /** Allow additional unknown properties */
  [key: string]: unknown;
}

/**
 * On/Off state (switches, outlets, lights without dimming)
 */
export interface OnOffState extends BaseDeviceState {
  /** Power state - boolean or 0/1 */
  on?: number | boolean;
  /** Alternative state property */
  state?: number | boolean | "on" | "off";
  /** Alternative power property */
  power?: number | boolean;
}

/**
 * Brightness state (dimmable lights, dimmers)
 */
export interface BrightnessState extends OnOffState {
  /** Brightness level (0-100) */
  brightness?: number;
  /** Alternative brightness property */
  level?: number;
}

/**
 * Color state (RGB/RGBW/color temperature lights)
 */
export interface ColorState extends BrightnessState {
  /** Color value in various formats */
  color?: ColorValue;
  /** Color temperature in mireds (153-500) or kelvin */
  colorTemperature?: number;
  /** Color mode indicator */
  colorMode?: boolean | "rgb" | "xy" | "hs" | "ct";
}

/**
 * Cover/Blind state
 */
export interface CoverState extends BaseDeviceState {
  /** Position (0-100, 0=closed, 100=open) */
  position?: number;
  /** Cover state */
  cover?: "open" | "closed" | "stop";
  /** Movement indicator */
  moving?: number | boolean;
  /** Tilt angle */
  tilt?: number;
}

/**
 * Lock state
 */
export interface LockState extends Omit<BaseDeviceState, "status"> {
  /** Lock status */
  status?: "on" | "off" | "locked" | "unlocked" | "online" | "offline";
  /** Alternative lock property */
  lock?: "on" | "off" | "locked" | "unlocked";
}

/**
 * Thermostat state
 */
export interface ThermostatState extends BaseDeviceState {
  /** Target temperature setpoint */
  setpoint?: number;
  /** Alternative target temperature */
  targetTemperature?: number;
  /** Current/ambient temperature */
  temperature?: number;
  /** System mode */
  systemMode?: "off" | "heat" | "cool" | "auto" | "fan";
  /** Alternative mode property */
  mode?: string;
  /** Operation mode/preset */
  operationMode?: string;
  /** Fan mode */
  fanMode?: string;
  /** Running status indicator */
  running?: boolean;
}

/**
 * Temperature sensor state
 */
export interface TemperatureSensorState extends BaseDeviceState {
  /** Temperature reading */
  temperature?: number;
}

/**
 * Humidity sensor state
 */
export interface HumiditySensorState extends BaseDeviceState {
  /** Humidity percentage */
  humidity?: number;
}

/**
 * Contact sensor state
 */
export interface ContactSensorState extends BaseDeviceState {
  /** Contact status (true=open, false=closed) */
  contact?: boolean;
}

/**
 * Occupancy/Motion sensor state
 */
export interface OccupancySensorState extends BaseDeviceState {
  /** Occupancy detected */
  occupancy?: boolean;
  /** Motion detected (alternative) */
  motion?: boolean;
}

/**
 * Smoke detector state
 */
export interface SmokeSensorState extends BaseDeviceState {
  /** Smoke detected */
  smoke?: boolean;
}

/**
 * Water leak sensor state
 */
export interface WaterLeakSensorState extends BaseDeviceState {
  /** Water leak detected */
  waterLeak?: boolean;
}

/**
 * Gas sensor state
 */
export interface GasSensorState extends BaseDeviceState {
  /** Gas detected */
  gas?: boolean;
}

/**
 * Multi-sensor state (can have multiple readings)
 */
export interface MultiSensorState extends BaseDeviceState {
  temperature?: number;
  humidity?: number;
  pressure?: number;
  illuminance?: number;
  co2?: number;
  voc?: number;
  pm25?: number;
  pm10?: number;
}

/**
 * Generic sensor with action/event/scene triggers
 */
export interface TriggerSensorState extends BaseDeviceState {
  /** Action trigger */
  action?: string;
  /** Event trigger */
  event?: string;
  /** Scene trigger */
  scene?: string;
}

/**
 * Union type of all possible device states
 *
 * Note: This is a discriminated union. To narrow the type, check
 * which properties are present in the state object.
 */
export type DeviceState =
  | BaseDeviceState
  | OnOffState
  | BrightnessState
  | ColorState
  | CoverState
  | LockState
  | ThermostatState
  | TemperatureSensorState
  | HumiditySensorState
  | ContactSensorState
  | OccupancySensorState
  | SmokeSensorState
  | WaterLeakSensorState
  | GasSensorState
  | MultiSensorState
  | TriggerSensorState;

/**
 * Combined device status and state message
 * Can include both status and state properties
 */
export type DeviceStatusMessage = StatusMessage & Partial<DeviceState>;

/**
 * Device state message
 * Reports current device state
 * Topics: device/{deviceId}/*, fd/{serviceId}/{deviceId}/*
 */
export type DeviceStateMessage = DeviceState;

/**
 * Device command message
 * Commands to control devices
 * Topics: td/{deviceId}/*
 */
export type CommandMessage = Partial<DeviceState>;

/**
 * Union of all possible protocol message payloads
 * This represents the `message` field in ProtocolMessage
 */
export type ProtocolMessageData =
  | DeviceStatusMessage
  | DeviceStateMessage
  | CommandMessage;

/**
 * Type guards for protocol messages
 */
