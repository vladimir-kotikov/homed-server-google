// Types for Google Smart Home outbound responses and trait attributes/state

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OnOffAttributes extends Record<string, never> {}
export interface OnOffState extends Record<string, unknown> {
  on: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BrightnessAttributes extends Record<string, never> {}
export interface BrightnessState extends Record<string, unknown> {
  brightness: number; // 0-100
}

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

export interface OpenCloseAttributes extends Record<string, unknown> {
  discreteOnlyOpenClose?: boolean; // true if only fully open/closed supported
}

export interface OpenCloseState extends Record<string, unknown> {
  openPercent: number; // 0-100
}

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

export interface SyncResponsePayload {
  agentUserId: string;
  devices: GoogleDevice[];
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

export interface QueryResponsePayload {
  devices: {
    [deviceId: string]: QueryDeviceState;
  };
}

export interface ExecuteResponseCommand {
  ids: string[];
  status: "SUCCESS" | "PENDING" | "OFFLINE" | "ERROR";
  states?: Record<string, unknown>; // Trait-specific states after command
  errorCode?: string;
  debugString?: string;
}

export interface ExecuteResponsePayload {
  commands: ExecuteResponseCommand[];
}

type SmartHomeResponseBase<T> = {
  requestId: string;
  payload: T;
};

export type SmartHomeResponse = SmartHomeResponseBase<
  | SyncResponsePayload
  | QueryResponsePayload
  | ExecuteResponsePayload
  | Record<string, never>
>;

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

/**
 * Device state containing all trait states
 * Used internally for combining multiple trait states
 */
export interface GoogleDeviceState {
  online: boolean;
  status?: "SUCCESS" | "ERROR" | "OFFLINE";
  [traitState: string]: unknown; // Maps to trait state values
}
