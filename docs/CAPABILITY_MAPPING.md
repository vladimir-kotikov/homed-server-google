# Capability Mapping System

## Overview

The Capability Mapping System is the core component that translates between Homed device capabilities and Google Smart Home device types and traits. It enables Homed devices to be represented and controlled through Google Home Assistant.

## Architecture

### Components

1. **CapabilityMapper** (`src/services/mapper.service.ts`)
   - Main mapper class that orchestrates device and state conversion
   - Converts Homed devices to Google Smart Home format
   - Converts Google commands to Homed device commands
   - Converts device states between formats

2. **Trait Mappers** (`src/services/mapper/traits.ts`)
   - Individual trait implementations for specific capabilities
   - Support for 6 core traits: OnOff, Brightness, ColorSetting, OpenClose, TemperatureSetting, SensorState

3. **Device Type Mapping** (`src/services/mapper/device-types.ts`)
   - Maps Homed expose types to Google device types
   - Detects appropriate device type from available exposes
   - Determines supported traits based on device capabilities

## Supported Device Types

### Switches and Outlets

| Homed Expose | Google Type | Traits | Example                  |
| ------------ | ----------- | ------ | ------------------------ |
| `switch`     | SWITCH      | OnOff  | Light switch, relay      |
| `outlet`     | OUTLET      | OnOff  | Power outlet, smart plug |

### Lighting Devices

| Homed Expose           | Google Type | Traits                          | Example                     |
| ---------------------- | ----------- | ------------------------------- | --------------------------- |
| `light`                | LIGHT       | OnOff                           | Simple on/off light         |
| `light` + `brightness` | LIGHT       | OnOff, Brightness               | Dimmable light              |
| `color_light`          | LIGHT       | OnOff, Brightness, ColorSetting | RGB/Color temperature light |

### Door Locks

| Homed Expose | Google Type | Traits | Example              |
| ------------ | ----------- | ------ | -------------------- |
| `lock`       | LOCK        | OnOff  | Electronic door lock |

### Window Coverings

| Homed Expose | Google Type | Traits    | Example                              |
| ------------ | ----------- | --------- | ------------------------------------ |
| `cover`      | BLINDS      | OpenClose | Motorized blinds, curtains, shutters |

### Climate Control

| Homed Expose | Google Type | Traits             | Example         |
| ------------ | ----------- | ------------------ | --------------- |
| `thermostat` | THERMOSTAT  | TemperatureSetting | HVAC thermostat |

### Sensors

The SensorState trait supports both binary sensors (on/off states) and numeric sensors (measurement values).

**Binary Sensors**:

| Homed Expose | Google Type    | Traits      | State Property | Example                    |
| ------------ | -------------- | ----------- | -------------- | -------------------------- |
| `contact`    | SENSOR         | SensorState | `openclose`    | Door/window contact sensor |
| `occupancy`  | SENSOR         | SensorState | `occupancy`    | Occupancy sensor           |
| `motion`     | SENSOR         | SensorState | `occupancy`    | Motion detector            |
| `smoke`      | SMOKE_DETECTOR | SensorState | `smoke`        | Smoke detector             |
| `water_leak` | SENSOR         | SensorState | `waterleak`    | Water leak detector        |
| `gas`        | SENSOR         | SensorState | `gas`          | Gas sensor                 |

**Numeric Sensors** (use `currentSensorStateData` array):

| Homed Expose  | Google Type | Traits      | Sensor Name                | Unit                         | Example                  |
| ------------- | ----------- | ----------- | -------------------------- | ---------------------------- | ------------------------ |
| `temperature` | SENSOR      | SensorState | `AmbientTemperature`       | `DEGREES_CELSIUS`            | Temperature sensor       |
| `humidity`    | SENSOR      | SensorState | `AmbientHumidity`          | `PERCENT`                    | Humidity sensor          |
| `pressure`    | SENSOR      | SensorState | `AirPressure`              | `PASCALS`                    | Barometric pressure      |
| `co2`         | SENSOR      | SensorState | `CarbonDioxideLevel`       | `PARTS_PER_MILLION`          | CO₂ sensor               |
| `co`          | SENSOR      | SensorState | `CarbonMonoxideLevel`      | `PARTS_PER_MILLION`          | CO sensor                |
| `voc`         | SENSOR      | SensorState | `VolatileOrganicCompounds` | `PARTS_PER_MILLION`          | VOC sensor               |
| `pm25`        | SENSOR      | SensorState | `PM2.5`                    | `MICROGRAMS_PER_CUBIC_METER` | PM2.5 particulate sensor |
| `pm10`        | SENSOR      | SensorState | `PM10`                     | `MICROGRAMS_PER_CUBIC_METER` | PM10 particulate sensor  |

## Traits and State Mapping

### OnOff Trait

**Google Trait**: `action.devices.traits.OnOff`

**Supported Exposes**: switch, outlet, relay, light, lock

**Homed State Properties**:

- `on` (boolean or 0/1) - Primary on/off state
- `state` (0/1) - Alternative on/off state
- `power` (0/1) - Alternative power state

**Google State**:

```json
{
  "on": true
}
```

**Homed Command Format**:

```json
{
  "topic": "td/{deviceId}/switch",
  "message": { "on": 1 }
}
```

**Example - Turn Light On**:

```typescript
// Google command
{
  "command": "action.devices.commands.OnOff",
  "params": { "on": true }
}

// Maps to Homed
{
  "topic": "td/0x001/switch",
  "message": { "on": 1 }
}
```

### Brightness Trait

**Google Trait**: `action.devices.traits.Brightness`

**Supported Exposes**: brightness, dimmable_light, color_light

**Homed State Properties**:

- `brightness` (0-100) - Brightness level
- `level` (0-100) - Alternative brightness level

**Google State**:

```json
{
  "brightness": 75
}
```

**Homed Command Format**:

```json
{
  "topic": "td/{deviceId}/brightness",
  "message": { "brightness": 75 }
}
```

**Example - Set Brightness to 50%**:

```typescript
// Google command
{
  "command": "action.devices.commands.BrightnessAbsolute",
  "params": { "brightness": 50 }
}

// Maps to Homed
{
  "topic": "td/0x002/brightness",
  "message": { "brightness": 50 }
}
```

### ColorSetting Trait

**Google Trait**: `action.devices.traits.ColorSetting`

**Supported Exposes**: color_light, color

**Homed State Properties**:

- `color` (object) - Color in various formats:
  - `{ r: 0-255, g: 0-255, b: 0-255 }` - RGB
  - `{ x: 0-1, y: 0-1 }` - CIE XY
  - `"#RRGGBB"` - Hex string
- `colorTemperature` (2000-6500) - Color temperature in Kelvin

**Google State - RGB**:

```json
{
  "color": {
    "spectrumRgb": 16711680
  }
}
```

**Google State - Color Temperature**:

```json
{
  "color": {
    "temperatureK": 4000
  }
}
```

**Homed Command Format**:

```json
{
  "topic": "td/{deviceId}/color",
  "message": { "color": { "r": 255, "g": 0, "b": 0 } }
}
```

**Example - Set Color to Red**:

```typescript
// Google command
{
  "command": "action.devices.commands.ColorAbsolute",
  "params": {
    "color": { "spectrumRgb": 0xFF0000 }
  }
}

// Maps to Homed
{
  "topic": "td/0x003/color",
  "message": { "color": { "r": 255, "g": 0, "b": 0 } }
}
```

### OpenClose Trait

**Google Trait**: `action.devices.traits.OpenClose`

**Supported Exposes**: cover, blinds, curtain, shutter

**Homed State Properties**:

- `position` (0-100) - Position percentage (0=closed, 100=open)
- `state` (string) - "open", "closed", or intermediate values

**Google State**:

```json
{
  "openPercent": 50
}
```

**Homed Command Format**:

```json
{
  "topic": "td/{deviceId}/position",
  "message": { "position": 50 }
}
```

**Example - Open Blinds to 75%**:

```typescript
// Google command
{
  "command": "action.devices.commands.OpenClose",
  "params": { "openPercent": 75 }
}

// Maps to Homed
{
  "topic": "td/0x004/position",
  "message": { "position": 75 }
}
```

### TemperatureSetting Trait

**Google Trait**: `action.devices.traits.TemperatureSetting`

**Supported Exposes**: thermostat, temperature_controller

**Homed State Properties**:

- `temperature` (float) - Current ambient temperature in Celsius
- `setpoint` (float) - Target temperature setpoint in Celsius
- `mode` (string) - Thermostat mode: "heat", "cool", "off", "auto"

**Google State**:

```json
{
  "thermostatTemperatureAmbient": 20,
  "thermostatTemperatureSetpoint": 22,
  "thermostatMode": "heat"
}
```

**Homed Command Formats**:

Set Setpoint:

```json
{
  "topic": "td/{deviceId}/setpoint",
  "message": { "setpoint": 22 }
}
```

Set Mode:

```json
{
  "topic": "td/{deviceId}/mode",
  "message": { "mode": "heat" }
}
```

**Example - Set Temperature to 22°C in Heat Mode**:

```typescript
// Google command 1: Set temperature
{
  "command": "action.devices.commands.ThermostatTemperatureSetpoint",
  "params": { "thermostatTemperatureSetpoint": 22 }
}

// Maps to Homed
{
  "topic": "td/0x005/setpoint",
  "message": { "setpoint": 22 }
}

// Google command 2: Set mode
{
  "command": "action.devices.commands.ThermostatSetMode",
  "params": { "thermostatMode": "heat" }
}

// Maps to Homed
{
  "topic": "td/0x005/mode",
  "message": { "mode": "heat" }
}
```

### SensorState Trait

**Google Trait**: `action.devices.traits.SensorState`

**Supported Exposes**: contact, occupancy, motion, smoke, water_leak, gas, temperature, humidity, pressure, co, co2, voc, pm25, pm10

The SensorState trait supports both **binary sensors** (on/off state) and **numeric sensors** (measurement values).

#### Binary Sensors

Binary sensors report a discrete state (e.g., open/closed, occupied/unoccupied).

**Homed State Properties**:

- `occupancy` (boolean) - Occupancy detection
- `motion` (boolean) - Motion detection
- `contact` (boolean) - Door/window contact
- `smoke` (boolean) - Smoke detection
- `waterLeak` (boolean) - Water leak detection
- `gas` (boolean) - Gas detection

**Google State Examples**:

Occupancy:

```json
{
  "occupancy": "OCCUPIED"
}
```

Contact (Open/Closed):

```json
{
  "openclose": "OPEN"
}
```

Smoke:

```json
{
  "smoke": "SMOKE"
}
```

Water Leak:

```json
{
  "waterleak": "LEAK"
}
```

#### Numeric Sensors

Numeric sensors report measurement values with units. These sensors use the `currentSensorStateData` array in QUERY responses.

**Supported Numeric Sensor Types**:

| Homed Expose  | Google Sensor Name         | Unit                         | Description              |
| ------------- | -------------------------- | ---------------------------- | ------------------------ |
| `temperature` | `AmbientTemperature`       | `DEGREES_CELSIUS`            | Temperature in °C        |
| `humidity`    | `AmbientHumidity`          | `PERCENT`                    | Relative humidity %      |
| `pressure`    | `AirPressure`              | `PASCALS`                    | Barometric pressure (Pa) |
| `co2`         | `CarbonDioxideLevel`       | `PARTS_PER_MILLION`          | CO₂ concentration (ppm)  |
| `co`          | `CarbonMonoxideLevel`      | `PARTS_PER_MILLION`          | CO concentration (ppm)   |
| `voc`         | `VolatileOrganicCompounds` | `PARTS_PER_MILLION`          | VOC concentration (ppm)  |
| `pm25`        | `PM2.5`                    | `MICROGRAMS_PER_CUBIC_METER` | PM2.5 particles (µg/m³)  |
| `pm10`        | `PM10`                     | `MICROGRAMS_PER_CUBIC_METER` | PM10 particles (µg/m³)   |

**Homed State Properties**:

- `temperature` (number) - Temperature measurement
- `humidity` (number) - Humidity percentage
- `pressure` (number) - Pressure measurement
- `co2` (number) - CO₂ level
- `co` (number) - CO level
- `voc` (number) - VOC level
- `pm25` (number) - PM2.5 particle level
- `pm10` (number) - PM10 particle level

**Google State Format** (QUERY Response):

Single numeric sensor (temperature):

```json
{
  "currentSensorStateData": [
    {
      "name": "AmbientTemperature",
      "rawValue": 21.5
    }
  ]
}
```

Multiple numeric sensors (temperature + humidity + pressure):

```json
{
  "currentSensorStateData": [
    {
      "name": "AmbientTemperature",
      "rawValue": 21.5
    },
    {
      "name": "AmbientHumidity",
      "rawValue": 65
    },
    {
      "name": "AirPressure",
      "rawValue": 101325
    }
  ]
}
```

Air quality sensor (CO₂ + VOC + PM2.5):

```json
{
  "currentSensorStateData": [
    {
      "name": "CarbonDioxideLevel",
      "rawValue": 450
    },
    {
      "name": "VolatileOrganicCompounds",
      "rawValue": 200
    },
    {
      "name": "PM2.5",
      "rawValue": 12.5
    }
  ]
}
```

Mixed binary and numeric sensors (occupancy + temperature):

```json
{
  "occupancy": "OCCUPIED",
  "currentSensorStateData": [
    {
      "name": "AmbientTemperature",
      "rawValue": 22.0
    }
  ]
}
```

**Google Attributes Format** (SYNC Response):

Single numeric sensor:

```json
{
  "sensorStatesSupported": [
    {
      "name": "AmbientTemperature",
      "numericCapabilities": {
        "rawValueUnit": "DEGREES_CELSIUS"
      }
    }
  ]
}
```

Multiple numeric sensors:

```json
{
  "sensorStatesSupported": [
    {
      "name": "AmbientTemperature",
      "numericCapabilities": {
        "rawValueUnit": "DEGREES_CELSIUS"
      }
    },
    {
      "name": "AmbientHumidity",
      "numericCapabilities": {
        "rawValueUnit": "PERCENT"
      }
    },
    {
      "name": "AirPressure",
      "numericCapabilities": {
        "rawValueUnit": "PASCALS"
      }
    }
  ]
}
```

Mixed binary and numeric sensors:

```json
{
  "sensorStatesSupported": [
    {
      "name": "occupancy"
    },
    {
      "name": "AmbientTemperature",
      "numericCapabilities": {
        "rawValueUnit": "DEGREES_CELSIUS"
      }
    }
  ]
}
```

**Sensors are read-only** - they don't support commands.

#### Complete Device Examples

**Temperature Sensor**:

Homed Device State:

```json
{
  "temperature": 21.5
}
```

Google QUERY Response:

```json
{
  "online": true,
  "currentSensorStateData": [
    {
      "name": "AmbientTemperature",
      "rawValue": 21.5
    }
  ]
}
```

**Multi-Sensor Device** (Temperature + Humidity + Pressure):

Homed Device State:

```json
{
  "temperature": 21.5,
  "humidity": 65,
  "pressure": 101325
}
```

Google QUERY Response:

```json
{
  "online": true,
  "currentSensorStateData": [
    {
      "name": "AmbientTemperature",
      "rawValue": 21.5
    },
    {
      "name": "AmbientHumidity",
      "rawValue": 65
    },
    {
      "name": "AirPressure",
      "rawValue": 101325
    }
  ]
}
```

**Motion Sensor with Temperature** (Mixed Binary + Numeric):

Homed Device State:

```json
{
  "occupancy": true,
  "temperature": 22.0
}
```

Google QUERY Response:

```json
{
  "online": true,
  "occupancy": "OCCUPIED",
  "currentSensorStateData": [
    {
      "name": "AmbientTemperature",
      "rawValue": 22.0
    }
  ]
}
```

## Device Creation Example

### Simple On/Off Light

**Homed Device**:

```json
{
  "key": "0x001234",
  "name": "Living Room Light",
  "description": "Main ceiling light",
  "available": true,
  "endpoints": [
    {
      "id": 1,
      "exposes": ["light"],
      "options": {}
    }
  ]
}
```

**Google Device**:

```json
{
  "id": "client-001-0x001234",
  "type": "action.devices.types.LIGHT",
  "traits": ["action.devices.traits.OnOff"],
  "name": {
    "defaultNames": ["Living Room Light"],
    "name": "Living Room Light",
    "nicknames": ["Main ceiling light"]
  },
  "willReportState": true,
  "deviceInfo": {
    "manufacturer": "Homed",
    "model": "device",
    "hwVersion": "1.0",
    "swVersion": "1.0"
  }
}
```

### Advanced RGB Light

**Homed Device**:

```json
{
  "key": "0x005678",
  "name": "Bedroom RGB Light",
  "available": true,
  "endpoints": [
    {
      "id": 1,
      "name": "Light",
      "exposes": ["light", "brightness", "color_light"],
      "options": {
        "colorModel": "rgb"
      }
    }
  ]
}
```

**Google Device**:

```json
{
  "id": "client-001-0x005678",
  "type": "action.devices.types.LIGHT",
  "traits": [
    "action.devices.traits.OnOff",
    "action.devices.traits.Brightness",
    "action.devices.traits.ColorSetting"
  ],
  "name": {
    "defaultNames": ["Bedroom RGB Light"],
    "name": "Bedroom RGB Light",
    "nicknames": []
  },
  "attributes": {
    "colorModel": "rgb"
  },
  "willReportState": true,
  "deviceInfo": {
    "manufacturer": "Homed",
    "model": "device",
    "hwVersion": "1.0",
    "swVersion": "1.0"
  }
}
```

### Thermostat

**Homed Device**:

```json
{
  "key": "0x009999",
  "name": "Living Room Thermostat",
  "available": true,
  "endpoints": [
    {
      "id": 1,
      "exposes": ["thermostat"],
      "options": {
        "modes": ["off", "heat", "cool", "auto"]
      }
    }
  ]
}
```

**Google Device**:

```json
{
  "id": "client-001-0x009999",
  "type": "action.devices.types.THERMOSTAT",
  "traits": ["action.devices.traits.TemperatureSetting"],
  "name": {
    "defaultNames": ["Living Room Thermostat"],
    "name": "Living Room Thermostat",
    "nicknames": []
  },
  "attributes": {
    "availableThermostatModes": ["off", "heat", "cool", "auto"],
    "thermostatTemperatureUnit": "CELSIUS",
    "queryOnlyTemperatureSetting": false
  },
  "willReportState": true,
  "deviceInfo": {
    "manufacturer": "Homed",
    "model": "device",
    "hwVersion": "1.0",
    "swVersion": "1.0"
  }
}
```

### Multi-Sensor Device

**Homed Device**:

```json
{
  "key": "0x012345",
  "name": "Climate Sensor",
  "available": true,
  "endpoints": [
    {
      "id": 1,
      "exposes": ["temperature", "humidity", "pressure"]
    }
  ]
}
```

**Google Device**:

```json
{
  "id": "client-001-0x012345",
  "type": "action.devices.types.SENSOR",
  "traits": ["action.devices.traits.SensorState"],
  "name": {
    "defaultNames": ["Climate Sensor"],
    "name": "Climate Sensor",
    "nicknames": []
  },
  "attributes": {
    "sensorStatesSupported": [
      {
        "name": "AmbientTemperature",
        "numericCapabilities": {
          "rawValueUnit": "DEGREES_CELSIUS"
        }
      },
      {
        "name": "AmbientHumidity",
        "numericCapabilities": {
          "rawValueUnit": "PERCENT"
        }
      },
      {
        "name": "AirPressure",
        "numericCapabilities": {
          "rawValueUnit": "PASCALS"
        }
      }
    ]
  },
  "willReportState": true,
  "deviceInfo": {
    "manufacturer": "Homed",
    "model": "device",
    "hwVersion": "1.0",
    "swVersion": "1.0"
  }
}
```

### Motion Sensor with Temperature

**Homed Device**:

```json
{
  "key": "0x067890",
  "name": "Motion Sensor",
  "available": true,
  "endpoints": [
    {
      "id": 1,
      "exposes": ["occupancy", "temperature"]
    }
  ]
}
```

**Google Device**:

```json
{
  "id": "client-001-0x067890",
  "type": "action.devices.types.SENSOR",
  "traits": ["action.devices.traits.SensorState"],
  "name": {
    "defaultNames": ["Motion Sensor"],
    "name": "Motion Sensor",
    "nicknames": []
  },
  "attributes": {
    "sensorStatesSupported": [
      {
        "name": "occupancy"
      },
      {
        "name": "AmbientTemperature",
        "numericCapabilities": {
          "rawValueUnit": "DEGREES_CELSIUS"
        }
      }
    ]
  },
  "willReportState": true,
  "deviceInfo": {
    "manufacturer": "Homed",
    "model": "device",
    "hwVersion": "1.0",
    "swVersion": "1.0"
  }
}
```

## Usage in Code

### Getting Google Devices (SYNC Intent)

```typescript
import { DeviceService } from "./services/device.service";
import { TCPServer } from "./tcp/server";

const tcpServer = new TCPServer(8042);
const deviceService = new DeviceService(tcpServer);

// Get Google format devices for SYNC
const googleDevices = await deviceService.getGoogleDevices(userId);

// Returns array of GoogleDevice objects ready for Google Home
```

### Querying Device States (QUERY Intent)

```typescript
// Get device states
const homedDevices = await deviceService.getAllDevices(userId);
const states = await deviceService.queryDeviceStates(userId, deviceKeys);

// Convert to Google format
const googleDevices = homedDevices; // Already structured
const googleStates = await deviceService.getGoogleDeviceState(
  googleDevice,
  homedState
);

// googleStates contains properly formatted state:
// {
//   "on": true,
//   "brightness": 75,
//   "online": true,
//   "status": "SUCCESS"
// }
```

### Executing Commands (EXECUTE Intent)

```typescript
// Receive Google command
const googleCommand = {
  command: "action.devices.commands.BrightnessAbsolute",
  params: { brightness: 50 },
};

// Execute on device
const result = await deviceService.executeGoogleCommand(
  userId,
  homedDevice,
  googleCommand
);

// Internally maps to:
// {
//   "topic": "td/0x001/brightness",
//   "message": { "brightness": 50 }
// }
```

## Error Handling

### Device Not Found

If a Google device ID doesn't map to any Homed device:

- QUERY returns: `{ "online": false, "status": "OFFLINE" }`
- EXECUTE returns: `{ "status": "ERROR", "errorCode": "deviceNotFound" }`

### Unsupported Command

If a device doesn't support a trait or command:

- EXECUTE returns: `{ "status": "ERROR", "errorCode": "hardError" }`
- Error details included in `debugString`

### Offline/Unavailable Device

If device is offline (`available: false`):

- QUERY returns: `{ "online": false }`
- EXECUTE returns: `{ "status": "ERROR", "errorCode": "deviceOffline" }`

## Testing

The mapper is thoroughly tested with 144+ unit tests covering:

- All device types and trait combinations
- State conversions with boundary conditions
- Command mapping with parameter validation
- Binary and numeric sensor mappings
- Air quality sensors (CO₂, CO, VOC, PM2.5, PM10)
- Multi-sensor devices (temperature + humidity + pressure)
- Mixed binary and numeric sensors (occupancy + temperature)
- Edge cases (missing data, invalid formats, NaN handling, etc.)
- Real-world scenarios (complex devices, multiple traits, multiple endpoints)

Run tests:

```bash
npm run test:unit -- tests/unit/mapper.test.ts
```

## Future Enhancements

1. **Custom Device Mappings** - Allow users to customize device type and trait mappings
2. **Caching** - Cache device capabilities to improve performance
3. **Incremental Sync** - Only report changed devices
4. **Additional Numeric Sensors** - Support for more sensor types (light level, UV index, noise level, etc.)
5. **Unit Conversion** - Support temperature in Fahrenheit or other units
6. **Enhanced Air Quality** - Support for air quality index calculations and thresholds
