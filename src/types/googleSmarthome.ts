/**
 * Refactored Google Smart Home API types with concrete trait types
 * Replaces generic 'any' types from types.ts
 */

/**
 * Google Smart Home trait attribute and state types
 * Concrete types for all supported traits replacing generic 'any' types
 */

// ===========================================================================
// OnOff Trait
// ===========================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OnOffAttributes extends Record<string, never> {}

export interface OnOffState extends Record<string, unknown> {
  on: boolean;
}

// ===========================================================================
// Brightness Trait
// ===========================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BrightnessAttributes extends Record<string, never> {}

export interface BrightnessState extends Record<string, unknown> {
  brightness: number; // 0-100
}

// ===========================================================================
// ColorSetting Trait
// ===========================================================================

export interface ColorSettingAttributes extends Record<string, unknown> {
  colorModel?: "rgb" | "hsv"; // rgb or hsv
}

export interface SpectrumRgbColor {
  spectrumRgb: number; // 24-bit RGB integer
}

export interface SpectrumHsvColor {
  spectrumHsv: {
    hue: number; // 0-360
    saturation: number; // 0-100
    value: number; // 0-100
  };
}

export interface TemperatureKColor {
  temperatureK: number; // 1000-25000 Kelvin
}

export type ColorValue =
  | SpectrumRgbColor
  | SpectrumHsvColor
  | TemperatureKColor;

/**
 * Type discriminator functions for ColorValue union
 */
export function isSpectrumRgbColor(
  color: ColorValue
): color is SpectrumRgbColor {
  return "spectrumRgb" in color;
}

export function isSpectrumHsvColor(
  color: ColorValue
): color is SpectrumHsvColor {
  return "spectrumHsv" in color;
}

export function isTemperatureKColor(
  color: ColorValue
): color is TemperatureKColor {
  return "temperatureK" in color;
}

export interface ColorSettingState extends Record<string, unknown> {
  color: ColorValue;
}

// ===========================================================================
// OpenClose Trait
// ===========================================================================

export interface OpenCloseAttributes extends Record<string, unknown> {
  discreteOnlyOpenClose?: boolean; // true if only fully open/closed supported
}

export interface OpenCloseState extends Record<string, unknown> {
  openPercent: number; // 0-100
}

// ===========================================================================
// TemperatureSetting Trait
// ===========================================================================

export type ThermostatMode =
  | "off"
  | "heat"
  | "cool"
  | "auto"
  | "drying"
  | "eco"
  | "heatCool";

/**
 * Type guard to validate and narrow unknown to ThermostatMode
 */
export function isThermostatMode(value: unknown): value is ThermostatMode {
  return (
    typeof value === "string" &&
    ["off", "heat", "cool", "auto", "drying", "eco", "heatcool"].includes(
      value.toLowerCase()
    )
  );
}

export interface TemperatureSettingAttributes extends Record<string, unknown> {
  availableThermostatModes: ThermostatMode[];
  thermostatTemperatureUnit: "CELSIUS" | "FAHRENHEIT";
  queryOnlyTemperatureSetting?: boolean;
  thermostatTemperatureRange?: {
    minThresholdCelsius: number;
    maxThresholdCelsius: number;
  };
  hoverTemperatureRange?: {
    minThresholdCelsius: number;
    maxThresholdCelsius: number;
  };
  bufferRangeCelsius?: number;
}

export interface TemperatureSettingState extends Record<string, unknown> {
  thermostatTemperatureAmbient?: number; // Current temperature
  thermostatTemperatureSetpoint?: number; // Target temperature
  thermostatMode?: ThermostatMode;
  thermostatHumidityAmbient?: number; // Current humidity percentage
}

// ===========================================================================
// SensorState Trait
// ===========================================================================

export type SensorName =
  | "occupancy"
  | "openclose"
  | "smoke"
  | "waterleak"
  | "gas"
  | "filter_cleanliness"
  | "filter_life_time"
  | "air_quality";

export interface SensorStateSupported {
  name: SensorName;
}

export interface SensorStateAttributes extends Record<string, unknown> {
  sensorStatesSupported: SensorStateSupported[];
}

export type OccupancyState = "OCCUPIED" | "UNOCCUPIED";
export type OpenCloseContactState = "OPEN" | "CLOSED";
export type SmokeState = "SMOKE" | "NO_SMOKE";
export type WaterLeakState = "LEAK" | "NO_LEAK";
export type GasState = "HIGH" | "NORMAL";
export type FilterCleanlinessState = "CLEAN" | "SLIGHTLY_DIRTY" | "VERY_DIRTY";

/**
 * Flat sensor state - individual sensor properties
 * Used internally by trait mapper and merged into device state
 */
export interface SensorStateFlat extends Record<string, unknown> {
  occupancy?: OccupancyState;
  openclose?: OpenCloseContactState;
  smoke?: SmokeState;
  waterleak?: WaterLeakState;
  gas?: GasState;
  filter_cleanliness?: FilterCleanlinessState;
  filter_life_time?: number; // Percentage 0-100
  air_quality?: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "VERY_POOR";
}

/**
 * Wrapped sensor state for Google API responses
 */
export interface SensorStateValue {
  occupancy?: OccupancyState;
  openclose?: OpenCloseContactState;
  smoke?: SmokeState;
  waterleak?: WaterLeakState;
  gas?: GasState;
  filter_cleanliness?: FilterCleanlinessState;
  filter_life_time?: number;
  air_quality?: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "VERY_POOR";
}

export interface SensorState extends Record<string, unknown> {
  sensorStates: SensorStateValue[];
}

// ===========================================================================
// Command Parameters
// ===========================================================================

export interface OnOffParameters {
  on: boolean;
}

export interface BrightnessParameters {
  brightness: number; // 0-100
}

export interface ColorSettingParameters {
  color: ColorValue;
}

export interface OpenCloseParameters {
  openPercent?: number; // 0-100, optional for discrete only
}

export interface TemperatureSetpointParameters {
  thermostatTemperatureSetpoint: number;
}

export interface TemperatureModeParameters {
  thermostatMode: ThermostatMode;
}

export type TraitParameters =
  | OnOffParameters
  | BrightnessParameters
  | ColorSettingParameters
  | OpenCloseParameters
  | TemperatureSetpointParameters
  | TemperatureModeParameters;

// ===========================================================================
// Union Types for Trait Attributes and States
// ===========================================================================

export type TraitAttributes =
  | OnOffAttributes
  | BrightnessAttributes
  | ColorSettingAttributes
  | OpenCloseAttributes
  | TemperatureSettingAttributes
  | SensorStateAttributes;

export type TraitState =
  | OnOffState
  | BrightnessState
  | ColorSettingState
  | OpenCloseState
  | TemperatureSettingState
  | SensorState;

// ===========================================================================
// Type Guards
// ===========================================================================

export function isOnOffState(state: unknown): state is OnOffState {
  return typeof state === "object" && state !== null && "on" in state;
}

export function isBrightnessState(state: unknown): state is BrightnessState {
  return typeof state === "object" && state !== null && "brightness" in state;
}

export function isOpenCloseState(state: unknown): state is OpenCloseState {
  return typeof state === "object" && state !== null && "openPercent" in state;
}

export function isTemperatureSettingState(
  state: unknown
): state is TemperatureSettingState {
  return (
    typeof state === "object" &&
    state !== null &&
    ("thermostatTemperatureAmbient" in state ||
      "thermostatTemperatureSetpoint" in state ||
      "thermostatMode" in state ||
      "thermostatHumidityAmbient" in state)
  );
}

export function isOnOffParameters(
  parameters: unknown
): parameters is OnOffParameters {
  return (
    typeof parameters === "object" && parameters !== null && "on" in parameters
  );
}

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

// ===========================================================================
// Request Types
// ===========================================================================

export interface SyncRequest {
  requestId: string;
  inputs: [{ intent: "action.devices.SYNC" }];
}

export interface QueryRequest {
  requestId: string;
  inputs: [
    {
      intent: "action.devices.QUERY";
      payload: {
        devices: [{ id: string }];
      };
    },
  ];
}

export interface ExecuteRequest {
  requestId: string;
  inputs: [
    {
      intent: "action.devices.EXECUTE";
      payload: {
        commands: [
          {
            devices: [{ id: string }];
            execution: [
              {
                command: string;
                params?: TraitParameters;
              },
            ];
          },
        ];
      };
    },
  ];
}

export interface DisconnectRequest {
  requestId: string;
  inputs: [{ intent: "action.devices.DISCONNECT" }];
}

export type SmartHomeRequest =
  | SyncRequest
  | QueryRequest
  | ExecuteRequest
  | DisconnectRequest;

// ===========================================================================
// Response Types
// ===========================================================================

export interface SyncResponse {
  requestId: string;
  payload: {
    agentUserId: string;
    devices: GoogleDevice[];
  };
}

/**
 * Device state in QUERY response
 * Contains online status and trait-specific states
 */
export interface QueryDeviceState {
  online: boolean;
  status?: "SUCCESS" | "ERROR" | "OFFLINE";
  [key: string]: unknown; // Trait-specific state values
}

export interface QueryResponse {
  requestId: string;
  payload: {
    devices: {
      [deviceId: string]: QueryDeviceState;
    };
  };
}

export interface ExecuteResponseCommand {
  ids: string[];
  status: "SUCCESS" | "PENDING" | "OFFLINE" | "ERROR";
  states?: Record<string, unknown>; // Trait-specific states after command
  errorCode?: string;
  debugString?: string;
}

export interface ExecuteResponse {
  requestId: string;
  payload: {
    commands: ExecuteResponseCommand[];
  };
}

export interface DisconnectResponse {
  requestId: string;
  payload: Record<string, never>;
}

export type SmartHomeResponse =
  | SyncResponse
  | QueryResponse
  | ExecuteResponse
  | DisconnectResponse;

// ===========================================================================
// Device Types
// ===========================================================================

export interface GoogleDeviceName {
  defaultNames: string[];
  name: string;
  nicknames: string[];
}

export interface GoogleDeviceInfo {
  manufacturer: string;
  model: string;
  hwVersion: string;
  swVersion: string;
}

/**
 * Device attributes map - maps trait names to their attributes
 * Allows partial updates with only relevant attributes
 */
export interface GoogleDeviceAttributes {
  [traitName: string]: TraitAttributes;
}

export interface GoogleDevice {
  id: string;
  type: string;
  traits: string[];
  name: GoogleDeviceName;
  willReportState: boolean;
  attributes?: GoogleDeviceAttributes;
  deviceInfo?: GoogleDeviceInfo;
  customData?: Record<string, unknown>;
}

// ===========================================================================
// Command Types
// ===========================================================================

export interface GoogleCommand {
  command: string;
  params?: TraitParameters;
}

export interface ExecutionCommand {
  command: string;
  params?: TraitParameters;
}

// ===========================================================================
// Internal State Types
// ===========================================================================

/**
 * Device state containing all trait states
 * Used internally for combining multiple trait states
 */
export interface GoogleDeviceState {
  online: boolean;
  status?: "SUCCESS" | "ERROR" | "OFFLINE";
  [traitState: string]: unknown; // Maps to trait state values
}

// ===========================================================================
// Type Guards
// ===========================================================================

export function isQueryDeviceState(value: unknown): value is QueryDeviceState {
  return (
    typeof value === "object" &&
    value !== null &&
    "online" in value &&
    // After confirming the object has 'online' property, we access it for type checking.
    // Cast needed because TypeScript can't narrow to a property access before type assertion.
    typeof (value as Record<string, unknown>).online === "boolean"
  );
}

export function isGoogleDevice(value: unknown): value is GoogleDevice {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    "traits" in value &&
    "name" in value &&
    // Cast needed to access and check array type for 'traits' property.
    // Object shape has been validated, but property type still needs verification.
    Array.isArray((value as Record<string, unknown>).traits)
  );
}

export function isGoogleCommand(value: unknown): value is GoogleCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    "command" in value &&
    // Cast needed to access and check string type for 'command' property.
    typeof (value as Record<string, unknown>).command === "string"
  );
}

// ===========================================================================
// Request/Response Type Guards
// ===========================================================================

export function isSyncRequest(input: unknown): input is SyncRequest {
  return (
    typeof input === "object" &&
    input !== null &&
    "requestId" in input &&
    "inputs" in input &&
    // Cast needed to check if 'inputs' is an array before accessing array methods.
    Array.isArray((input as Record<string, unknown>).inputs) &&
    (input as SyncRequest).inputs[0]?.intent === "action.devices.SYNC"
  );
}

export function isQueryRequest(input: unknown): input is QueryRequest {
  return (
    typeof input === "object" &&
    input !== null &&
    "requestId" in input &&
    "inputs" in input &&
    // Cast needed to check if 'inputs' is an array before accessing array methods.
    Array.isArray((input as Record<string, unknown>).inputs) &&
    (input as QueryRequest).inputs[0]?.intent === "action.devices.QUERY"
  );
}

export function isExecuteRequest(input: unknown): input is ExecuteRequest {
  return (
    typeof input === "object" &&
    input !== null &&
    "requestId" in input &&
    "inputs" in input &&
    // Cast needed to check if 'inputs' is an array before accessing array methods.
    Array.isArray((input as Record<string, unknown>).inputs) &&
    (input as ExecuteRequest).inputs[0]?.intent === "action.devices.EXECUTE"
  );
}

export function isDisconnectRequest(
  input: unknown
): input is DisconnectRequest {
  return (
    typeof input === "object" &&
    input !== null &&
    "requestId" in input &&
    "inputs" in input &&
    // Cast needed to check if 'inputs' is an array before accessing array methods.
    Array.isArray((input as Record<string, unknown>).inputs) &&
    (input as DisconnectRequest).inputs[0]?.intent ===
      "action.devices.DISCONNECT"
  );
}

export function isSmartHomeRequest(input: unknown): input is SmartHomeRequest {
  return (
    isSyncRequest(input) ||
    isQueryRequest(input) ||
    isExecuteRequest(input) ||
    isDisconnectRequest(input)
  );
}
