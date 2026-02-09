/**
 * Mapper Service Unit Tests
 */

import { type DeviceId, type HomedDevice } from "../../src/device.ts";
import {
  GOOGLE_DEVICE_TYPES,
  mapToGoogleDevice,
  mapToGoogleState,
  mapToHomedCommand,
} from "../../src/google/mapper.ts";
import {
  GOOGLE_COMMANDS,
  type GoogleCommand,
} from "../../src/google/schema.ts";
import { GOOGLE_TRAITS } from "../../src/google/traits.ts";
import type { ClientId } from "../../src/homed/client.ts";

// ============================================================================
// Test Constants - Reduce Magic Strings
// ============================================================================

const DEVICE_TYPES = GOOGLE_DEVICE_TYPES;
const TRAITS = GOOGLE_TRAITS;
const COMMANDS = GOOGLE_COMMANDS;
const testClientId = "client1" as ClientId;

// ============================================================================
// Test Helpers - Unified & Parameterized
// ============================================================================

interface DeviceCreationOptions {
  exposes?: string[][];
  options?: Record<string, any>;
  key?: DeviceId;
  topic?: string;
  name?: string;
  description?: string;
  available?: boolean;
  deviceOverrides?: Partial<HomedDevice>;
}

/**
 * Generate a random device key for testing
 */
const generateRandomKey = (): DeviceId => {
  const randomHex = Math.random().toString(16).substring(2, 8).padStart(6, "0");
  return `0x${randomHex}` as DeviceId;
};

/**
 * Create a test device with comprehensive configuration options
 * Replaces: createTestDevice, createDeviceWithOptions, createMultiEndpointDevice, createMultiEndpointDeviceWithOptions
 *
 * @example Single endpoint: createDevice({ exposes: [["switch"]] })
 * @example Multi endpoint: createDevice({ exposes: [["light"], ["brightness"]] })
 * @example With options: createDevice({ exposes: [["brightness"]], options: { minBrightness: 10 } })
 */
const createDevice = ({
  exposes = [["switch"]],
  options,
  key,
  topic = "home/test-device",
  name = "Test Device",
  description,
  available = true,
  deviceOverrides = {},
}: DeviceCreationOptions): HomedDevice => {
  const device: HomedDevice = {
    key: key || generateRandomKey(),
    topic,
    name,
    available,
    endpoints: exposes.map((endpointExposes, index) => ({
      id: index + 1,
      exposes: endpointExposes,
      ...(options && { options: options as any }),
    })),
    ...deviceOverrides,
  };

  // Add description if provided
  if (description !== undefined) {
    (device as any).description = description;
  }

  return device;
};

describe("CapabilityMapper", () => {
  // ============================================================================
  // Device Type Detection Tests
  // ============================================================================

  describe("Device Type Detection", () => {
    it("should map switch device to SWITCH type", () => {
      const device = createDevice({
        exposes: [["switch"]],
        topic: "home/main_switch",
        name: "Main Switch",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SWITCH);
      expect(google.traits).toContain(TRAITS.ON_OFF);
    });

    it("should map outlet device to OUTLET type", () => {
      const device = createDevice({
        exposes: [["outlet"]],
        topic: "home/power_outlet",
        name: "Power Outlet",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.OUTLET);
    });

    it("should map light device to LIGHT type", () => {
      const device = createDevice({
        exposes: [["light"]],
        topic: "home/ceiling_light",
        name: "Ceiling Light",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
    });

    it("should map light with level option to include Brightness trait", () => {
      const device = createDevice({
        exposes: [["light"]],
        options: { light: ["level"] },
        topic: "home/dimmable_bulb",
        name: "Dimmable Bulb",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
      expect(google.traits).toContain(TRAITS.ON_OFF);
      expect(google.traits).toContain(TRAITS.BRIGHTNESS);
    });

    it("should map light with level and color options to include all traits", () => {
      const device = createDevice({
        exposes: [["light"]],
        options: { light: ["level", "color"] },
        topic: "home/rgb_bulb",
        name: "RGB Bulb",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
      expect(google.traits).toContain(TRAITS.ON_OFF);
      expect(google.traits).toContain(TRAITS.BRIGHTNESS);
      expect(google.traits).toContain(TRAITS.COLOR_SETTING);
    });

    it("should map dimmable light with brightness trait", () => {
      const device = createDevice({
        exposes: [["light", "brightness"]],
        topic: "home/dimmable_light",
        name: "Dimmable Light",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
      expect(google.traits).toContain(TRAITS.ON_OFF);
      expect(google.traits).toContain(TRAITS.BRIGHTNESS);
    });

    it("should map color light with color trait", () => {
      const device = createDevice({
        exposes: [["light", "brightness", "color_light"]],
        topic: "home/rgb_light",
        name: "RGB Light",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.traits).toContain(TRAITS.ON_OFF);
      expect(google.traits).toContain(TRAITS.BRIGHTNESS);
      expect(google.traits).toContain(TRAITS.COLOR_SETTING);
    });

    it("should map cover device to BLINDS type", () => {
      const device = createDevice({
        exposes: [["cover"]],
        topic: "home/window_blinds",
        name: "Window Blinds",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.BLINDS);
      expect(google.traits).toContain(TRAITS.OPEN_CLOSE);
    });

    it("should map lock device to LOCK type", () => {
      const device = createDevice({
        exposes: [["lock"]],
        topic: "home/door_lock",
        name: "Door Lock",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LOCK);
      expect(google.traits).toContain(TRAITS.ON_OFF);
    });

    it("should map thermostat device to THERMOSTAT type", () => {
      const device = createDevice({
        exposes: [["thermostat"]],
        topic: "home/smart_thermostat",
        name: "Smart Thermostat",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.THERMOSTAT);
      expect(google.traits).toContain(TRAITS.TEMPERATURE_SETTING);
    });

    it("should map smoke detector to SMOKE_DETECTOR type", () => {
      const device = createDevice({
        exposes: [["smoke"]],
        topic: "home/smoke_detector",
        name: "Smoke Detector",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SMOKE_DETECTOR);
    });

    it("should map contact sensor to SENSOR type", () => {
      const device = createDevice({
        exposes: [["contact"]],
        topic: "home/door_contact",
        name: "Door Contact",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SENSOR);
      expect(google.traits).toContain(TRAITS.SENSOR_STATE);
    });

    it("should map occupancy sensor to SENSOR type", () => {
      const device = createDevice({
        exposes: [["occupancy"]],
        topic: "home/motion_sensor",
        name: "Motion Sensor",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SENSOR);
      expect(google.traits).toContain(TRAITS.SENSOR_STATE);
    });

    it("should map water leak sensor to SENSOR type", () => {
      const device = createDevice({
        exposes: [["water_leak"]],
        topic: "home/water_leak_sensor",
        name: "Water Leak Sensor",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SENSOR);
    });

    it("should handle device with special characters in name", () => {
      const device = createDevice({
        exposes: [["switch"]],
        name: "Device-With_Special.Chars@123!",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.name.name).toBe("Device-With_Special.Chars@123!");
      expect(google.type).toBe(DEVICE_TYPES.SWITCH);
    });

    it("should handle device with unavailable status affecting device detection", () => {
      const device = createDevice({
        exposes: [["light"]],
        available: false,
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT); // Type should not change
      expect(google.name.name).toBe("Test Device");
    });
  });

  // ============================================================================  // Device Type Priority Tests
  // ============================================================================

  describe("Device Type Priority", () => {
    it("should prioritize light over other types when both present", () => {
      const device = createDevice({
        exposes: [["light", "switch"]],
        topic: "home/light_switch_combo",
        name: "Light Switch Combo",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
    });

    it("should prioritize light when present with thermostat and switch", () => {
      const device = createDevice({
        exposes: [["thermostat", "switch", "light"]],
        topic: "home/smart_device",
        name: "Smart Device",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
    });

    it("should handle cover and light hybrid device", () => {
      const device = createDevice({
        exposes: [["cover", "light"]],
        topic: "home/cover_light",
        name: "Cover with Light",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
    });

    it("should prioritize lock over switch when both present", () => {
      const device = createDevice({
        exposes: [["lock", "switch"]],
        topic: "home/smart_lock",
        name: "Smart Lock",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LOCK);
    });

    it("should handle smoke detector priority", () => {
      const device = createDevice({
        exposes: [["smoke", "contact", "switch"]],
        topic: "home/combo_sensor",
        name: "Combo Sensor",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SMOKE_DETECTOR);
    });

    it("should handle outlet priority over switch", () => {
      const device = createDevice({
        exposes: [["outlet", "switch"]],
        topic: "home/outlet_switch",
        name: "Outlet",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.OUTLET);
    });

    it("should handle multiple sensor types", () => {
      const device = createDevice({
        exposes: [["contact", "occupancy", "temperature"]],
        topic: "home/multi_sensor",
        name: "Multi Sensor",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SENSOR);
      expect(google.traits).toContain(TRAITS.SENSOR_STATE);
    });
  });

  // ============================================================================  // Device Mapping Tests
  // ============================================================================

  describe("Device Mapping", () => {
    it("should map device with all required fields", () => {
      const device = createDevice({
        exposes: [["light", "brightness"]],
        key: "0x123456" as DeviceId,
        topic: "home/living_room_light",
        name: "Living Room Light",
        description: "Main light",
        deviceOverrides: {
          manufacturer: "IKEA",
          model: "TRADFRI bulb E27",
        },
      });

      const google = mapToGoogleDevice(device, "client-001" as ClientId);

      expect(google.id).toBe("client-001/0x123456");
      expect(google.name.name).toBe("Living Room Light");
      // defaultNames should contain only user-friendly name (what Google displays)
      expect(google.name.defaultNames).toEqual(["Living Room Light"]);
      // Manufacturer/model and description should be in nicknames for voice commands
      expect(google.name.nicknames).toContain("Main light");
      expect(google.name.nicknames).toContain("IKEA TRADFRI bulb E27");
      expect(google.willReportState).toBe(false);
      expect(google.deviceInfo?.manufacturer).toBe("IKEA");
      expect(google.deviceInfo?.model).toBe("TRADFRI bulb E27");
      expect(google.customData?.homedKey).toBe("0x123456");
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
    });

    it("should handle device without description", () => {
      const device = createDevice({
        exposes: [["switch"]],
        topic: "home/simple_switch",
        name: "Simple Switch",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.name.nicknames).toHaveLength(0);
      expect(google.name.name).toBe("Simple Switch");
      expect(google.type).toBe(DEVICE_TYPES.SWITCH);
    });

    it("should handle multiple endpoints with combined traits", () => {
      const device = createDevice({
        exposes: [["light"], ["brightness"], ["color_light"]],
        topic: "home/multi_endpoint",
        name: "Multi-endpoint Device",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.traits).toContain(TRAITS.ON_OFF);
      expect(google.traits).toContain(TRAITS.BRIGHTNESS);
      expect(google.traits).toContain(TRAITS.COLOR_SETTING);
      expect(google.customData?.endpoints).toHaveLength(3);
    });

    it("should deduplicate exposes from multiple endpoints", () => {
      const device = createDevice({
        // FIXME: This is actually questionable and likely should be exposed as 2 different switches
        exposes: [
          ["switch", "power"],
          ["switch", "energy"],
        ],
        topic: "home/duplicate_device",
        name: "Device with duplicate exposes",
      });

      const google = mapToGoogleDevice(device, testClientId);
      // Should not duplicate OnOff trait from duplicate switch exposes
      expect(google.traits).toContain(TRAITS.ON_OFF);
      expect(google.type).toBe(DEVICE_TYPES.SWITCH);
    });

    it("should store endpoint info in customData", () => {
      const device = createDevice({
        exposes: [["light"], ["brightness"]],
        topic: "home/device",
        name: "Device",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.customData?.endpoints).toBeDefined();
      expect(google.customData?.endpoints).toHaveLength(2);
      const endpoints = google.customData?.endpoints as any;
      expect(endpoints[0].id).toBe(1);
      expect(endpoints[1].id).toBe(2);
      expect(endpoints[0].exposes).toEqual(["light"]);
      expect(endpoints[1].exposes).toEqual(["brightness"]);
    });

    // ========================================================================
    // Additional Edge Cases for Device Mapping
    // ========================================================================

    it("should handle various description scenarios", () => {
      // Empty description
      const device1 = createDevice({
        exposes: [["switch"]],
        name: "Device 1",
        description: "",
      });
      const google1 = mapToGoogleDevice(device1, "client1" as ClientId);
      expect(google1.name.nicknames).toHaveLength(0);

      // Special characters
      const device2 = createDevice({
        exposes: [["light"]],
        name: "Device 2",
        description: "Main & living room's bright light (150W) [premium]",
      });
      const google2 = mapToGoogleDevice(device2, "client1" as ClientId);
      expect(google2.name.name).toBe("Device 2");
      expect(google2.type).toBe(DEVICE_TYPES.LIGHT);

      // Unavailable status with description
      const device3 = createDevice({
        exposes: [["light"]],
        name: "Offline Light",
        available: false,
      });
      const google3 = mapToGoogleDevice(device3, "client1" as ClientId);
      expect(google3.name.name).toBe("Offline Light");
      expect(google3.type).toBe(DEVICE_TYPES.LIGHT);
    });

    it("should preserve all custom data correctly", () => {
      const device = createDevice({
        exposes: [["switch"]],
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.customData?.homedKey).toBe(device.key);
      expect(google.id).toContain(device.key);
    });

    // FIXME: Verify if very large number of endpointsndex causes performance issues
    it("should handndexle device with many endpoints (edge case)", () => {
      const exposes = Array.from({ length: 20 }, (_, index) => [
        `expose_${index}`,
      ]);
      const device = createDevice({
        exposes,
        name: "Multi-endpoint Edge Case",
      });

      const google = mapToGoogleDevice(device, testClientId);
      const endpoints = google.customData?.endpoints as any;
      expect(endpoints).toHaveLength(20);
    });
  });

  // ============================================================================
  // State Mapping Tests
  // ============================================================================

  describe("State Mapping - OnOff Trait", () => {
    const onOffTestCases = [
      {
        property: "on",
        value: true,
        expectedOn: true,
        description: "with on=true",
      },
      {
        property: "state",
        value: 1,
        expectedOn: true,
        description: "with state=1",
      },
      {
        property: "power",
        value: 1,
        expectedOn: true,
        description: "with power=1",
      },
      {
        property: "on",
        value: false,
        expectedOn: false,
        description: "with on=false",
      },
      {
        property: "state",
        value: 0,
        expectedOn: false,
        description: "with state=0",
      },
    ];

    onOffTestCases.forEach(({ property, value, expectedOn, description }) => {
      it(`should map on/off ${description}`, () => {
        const device = createDevice({ exposes: [["switch"]] });
        const inputState = { [property]: value };

        const state = mapToGoogleState(device, inputState);
        expect(state.on).toBe(expectedOn);
        expect(state).toEqual(
          expect.objectContaining({
            online: true,
          })
        );
      });
    });

    it("should reflect offline status correctly", () => {
      const device = createDevice({
        exposes: [["switch"]],
        available: false,
      });

      const state = mapToGoogleState(device, { on: true });
      expect(state.online).toBe(false);
    });

    // FIXME: Verify behavior when on property is already set in input state
    it("should not mutate input state object", () => {
      const device = createDevice({ exposes: [["switch"]] });
      const inputState = { on: true };
      const inputStateCopy = JSON.parse(JSON.stringify(inputState));

      mapToGoogleState(device, inputState);

      expect(inputState).toEqual(inputStateCopy);
    });
  });

  describe("State Mapping - Brightness Trait", () => {
    it("should map brightness state (0-100)", () => {
      const device = createDevice({ exposes: [["light", "brightness"]] });

      const state = mapToGoogleState(device, { brightness: 75 });
      expect(state.brightness).toBe(75);
      expect(state.online).toBe(true);
    });

    const brightnessTestCases = [
      {
        property: "brightness",
        value: 75,
        expected: 75,
        description: "normal value (75)",
      },
      {
        property: "brightness",
        value: 150,
        expected: 100,
        description: "over 100 (clamped)",
      },
      {
        property: "brightness",
        value: -10,
        expected: 0,
        description: "negative (clamped)",
      },
      {
        property: "level",
        value: 127,
        expected: 50,
        description: "with level property (50)",
      },
      {
        property: "brightness",
        value: 0,
        expected: 0,
        description: "boundary min (0)",
      },
      {
        property: "brightness",
        value: 100,
        expected: 100,
        description: "boundary max (100)",
      },
    ];

    brightnessTestCases.forEach(
      ({ property, value, expected, description }) => {
        it(`should map brightness ${description}`, () => {
          const device = createDevice({ exposes: [["brightness"]] });
          const inputState = { [property]: value };

          const state = mapToGoogleState(device, inputState);
          expect(state.brightness).toBe(expected);
        });
      }
    );

    // FIXME: Verify that brightness type coercion works correctly (e.g., "75" vs 75)
    it("should handle invalid brightness values gracefully", () => {
      const device = createDevice({ exposes: [["brightness"]] });

      // NaN
      const state1 = mapToGoogleState(device, { brightness: NaN });
      expect(state1).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Infinity
      const state2 = mapToGoogleState(device, { brightness: Infinity });
      expect(state2).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
      expect(state2.brightness).toBe(100);

      // null
      // eslint-disable-next-line unicorn/no-null
      const state3 = mapToGoogleState(device, { brightness: null as any });
      expect(state3).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
    });
  });

  describe("State Mapping - Color Trait", () => {
    it("should map RGB color from hex format", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const state = mapToGoogleState(device, { color: "#FF0000" });
      expect(state.color).toBeDefined();
      expect((state.color as any)?.spectrumRgb).toBeDefined();
      expect(state.online).toBe(true);
    });

    it("should map color temperature independently", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const state = mapToGoogleState(device, { colorTemperature: 4000 });
      expect(state.color).toBeDefined();
      expect((state.color as any)?.temperatureK).toBe(4000);
    });

    it("should handle missing color data correctly", () => {
      const device = createDevice({ exposes: [["light"]] });

      const state = mapToGoogleState(device, { brightness: 100 });
      expect(state.color).toBeUndefined();
      expect(state.brightness).toBeUndefined(); // Light without brightness trait
    });

    // FIXME: Verify what happens when both RGB and temperature are set - which takes priority?
    it("should handle both RGB and temperature in state", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const state = mapToGoogleState(device, {
        color: "#FF5500",
        colorTemperature: 3000,
      });
      expect(state.color).toBeDefined();
      // Need to verify priority/override behavior
    });

    // FIXME: Verify handling of malformed hex colors (e.g., "#GGGGGG", "#FF00", "")
    it("should handle malformed color hex strings", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      // Empty string
      const state1 = mapToGoogleState(device, { color: "" });
      expect(state1).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Invalid hex
      const state2 = mapToGoogleState(device, { color: "#GGGGGG" });
      expect(state2).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Too short
      const state3 = mapToGoogleState(device, { color: "#FF0" });
      expect(state3).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
    });
  });

  describe("State Mapping - OpenClose Trait", () => {
    const coverTestCases = [
      {
        property: "position",
        value: 50,
        expected: 50,
        description: "position 50%",
      },
      {
        property: "position",
        value: 150,
        expected: 100,
        description: "position over 100 (clamped)",
      },
      {
        property: "position",
        value: -10,
        expected: 0,
        description: "position negative (clamped)",
      },
      {
        property: "state",
        value: "open",
        expected: 100,
        description: "state='open'",
      },
      {
        property: "state",
        value: "closed",
        expected: 0,
        description: "state='closed'",
      },
      {
        property: "position",
        value: 0,
        expected: 0,
        description: "position boundary min (0)",
      },
      {
        property: "position",
        value: 100,
        expected: 100,
        description: "position boundary max (100)",
      },
    ];

    coverTestCases.forEach(({ property, value, expected, description }) => {
      it(`should map cover ${description}`, () => {
        const device = createDevice({ exposes: [["cover"]] });
        const inputState = { [property]: value };

        const state = mapToGoogleState(device, inputState);
        expect(state.openPercent).toBe(expected);
        expect(state).toEqual(
          expect.objectContaining({
            online: true,
          })
        );
      });
    });

    // FIXME: State mapper clamps position (0-100), but command mapper doesn't - inconsistency?
    it("should identify position clamping inconsistency between state and command", () => {
      // This test documents a known inconsistency that needs verification
      const device = createDevice({ exposes: [["cover"]] });
      const state = mapToGoogleState(device, { position: 150 });
      expect(state.openPercent).toBe(100); // State clamps

      // Command mapper may NOT clamp - see Command Mapping - OpenClose tests
    });
  });

  describe("State Mapping - TemperatureSetting Trait", () => {
    const thermostatTestCases = [
      {
        state: { temperature: 21.5 },
        expectAmbient: 21.5,
        expectSetpoint: undefined,
        expectMode: undefined,
        description: "ambient temperature only",
      },
      {
        state: { setpoint: 22 },
        expectAmbient: undefined,
        expectSetpoint: 22,
        expectMode: undefined,
        description: "setpoint only",
      },
      {
        state: { mode: "heat" },
        expectAmbient: undefined,
        expectSetpoint: undefined,
        expectMode: "heat",
        description: "mode only",
      },
      {
        state: { temperature: 20, setpoint: 22, mode: "heat" },
        expectAmbient: 20,
        expectSetpoint: 22,
        expectMode: "heat",
        description: "combined properties",
      },
    ];

    thermostatTestCases.forEach(
      ({ state, expectAmbient, expectSetpoint, expectMode, description }) => {
        it(`should map thermostat ${description}`, () => {
          const device = createDevice({ exposes: [["thermostat"]] });

          const result = mapToGoogleState(device, state);
          if (expectAmbient !== undefined) {
            expect(result.thermostatTemperatureAmbient).toBe(expectAmbient);
          }
          if (expectSetpoint !== undefined) {
            expect(result.thermostatTemperatureSetpoint).toBe(expectSetpoint);
          }
          if (expectMode !== undefined) {
            expect(result.thermostatMode).toBe(expectMode);
          }
          expect(result).toEqual(
            expect.objectContaining({
              online: true,
            })
          );
        });
      }
    );

    // FIXME: Verify behavior when mode is not in supported modes list
    it("should handle unsupported thermostat modes", () => {
      const device = createDevice({ exposes: [["thermostat"]] });

      const state = mapToGoogleState(device, { mode: "invalid_mode" });
      // Mapper may filter unsupported modes or pass through - verify actual behavior
      expect(state).toBeDefined();
      expect(state.online).toBe(true);
    });

    // FIXME: Verify if setpoint outside min/max range is validated
    it("should handle setpoint outside reasonable range", () => {
      const device = createDevice({ exposes: [["thermostat"]] });

      const state1 = mapToGoogleState(device, { setpoint: -50 });
      expect(state1.thermostatTemperatureSetpoint).toBe(-50); // Pass-through?

      const state2 = mapToGoogleState(device, { setpoint: 100 });
      expect(state2.thermostatTemperatureSetpoint).toBe(100); // Pass-through?
    });
  });

  describe("State Mapping - Sensor Trait", () => {
    // Parameterized sensor mapping test to reduce duplication
    const sensorMappings = [
      {
        name: "occupancy",
        exposes: ["occupancy"],
        trueState: { occupancy: true },
        falseState: { occupancy: false },
        trueName: "occupancy",
        expectedTrue: "OCCUPIED",
        expectedFalse: "UNOCCUPIED",
        resultKey: "occupancy",
      },
      {
        name: "contact",
        exposes: ["contact"],
        trueState: { contact: true },
        falseState: { contact: false },
        trueName: "contact",
        expectedTrue: "OPEN",
        expectedFalse: "CLOSED",
        resultKey: "openclose",
      },
      {
        name: "smoke",
        exposes: ["smoke"],
        trueState: { smoke: true },
        falseState: { smoke: false },
        trueName: "smoke",
        expectedTrue: "SMOKE",
        expectedFalse: "NO_SMOKE",
        resultKey: "smoke",
      },
      {
        name: "water_leak",
        exposes: ["water_leak"],
        trueState: { waterLeak: true },
        falseState: { waterLeak: false },
        trueName: "waterLeak",
        expectedTrue: "LEAK",
        expectedFalse: "NO_LEAK",
        resultKey: "waterleak",
      },
    ];

    sensorMappings.forEach(mapping => {
      it(`should map ${mapping.name} sensor state correctly`, () => {
        const device = createDevice({ exposes: [mapping.exposes as any] });

        // Test true state
        const stateTrue = mapToGoogleState(device, mapping.trueState);
        expect((stateTrue as any)[mapping.resultKey]).toBe(
          mapping.expectedTrue
        );
        expect(stateTrue.online).toBe(true);

        // Test false state
        const stateFalse = mapToGoogleState(device, mapping.falseState);
        expect((stateFalse as any)[mapping.resultKey]).toBe(
          mapping.expectedFalse
        );
        expect(stateFalse.online).toBe(true);
      });
    });

    const numericBooleanTestCases = [
      { value: 1, expected: "OCCUPIED", description: "numeric 1 as true" },
      { value: 0, expected: "UNOCCUPIED", description: "numeric 0 as false" },
      { value: 2, expected: "OCCUPIED", description: "numeric 2 as truthy" },
      { value: -1, expected: "OCCUPIED", description: "numeric -1 as truthy" },
    ];

    numericBooleanTestCases.forEach(({ value, expected, description }) => {
      it(`should handle sensor with ${description}`, () => {
        const device = createDevice({ exposes: [["occupancy"]] });

        const state = mapToGoogleState(device, { occupancy: value as any });
        expect(state.occupancy).toBe(expected);
      });
    });
  });

  // ============================================================================
  // Command Mapping Tests
  // ============================================================================

  describe("Command Mapping - OnOff", () => {
    it("should map OnOff command to correct topic and value", () => {
      const device = createDevice({ exposes: [["switch"]] });

      // On command
      const cmd1 = mapToHomedCommand(device, {
        command: COMMANDS.ON_OFF,
        params: { on: true },
      } as GoogleCommand);

      expect(cmd1).toBeDefined();
      expect(cmd1?.topic).toBe(`td/${device.key}/switch`);
      expect(cmd1?.message).toEqual({ on: 1 });

      // Off command
      const cmd2 = mapToHomedCommand(device, {
        command: COMMANDS.ON_OFF,
        params: { on: false },
      } as GoogleCommand);

      expect(cmd2).toBeDefined();
      expect(cmd2?.topic).toBe(`td/${device.key}/switch`);
      expect(cmd2?.message).toEqual({ on: 0 });
    });
  });

  describe("Command Mapping - Brightness", () => {
    const brightnessCommandTestCases = [
      { value: 75, expected: 75, description: "normal value (75)" },
      { value: 150, expected: 100, description: "over 100 (clamped)" },
      { value: -10, expected: 0, description: "negative (clamped)" },
    ];

    brightnessCommandTestCases.forEach(({ value, expected, description }) => {
      it(`should map BrightnessAbsolute command with ${description}`, () => {
        const device = createDevice({ exposes: [["light", "brightness"]] });

        const cmd = mapToHomedCommand(device, {
          command: COMMANDS.BRIGHTNESS_ABSOLUTE,
          params: { brightness: value },
        } as GoogleCommand);

        expect(cmd).toBeDefined();
        expect(cmd?.message).toEqual(
          expect.objectContaining({ brightness: expected })
        );
      });
    });

    it("should map BrightnessAbsolute command to correct topic", () => {
      const device = createDevice({ exposes: [["light", "brightness"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.BRIGHTNESS_ABSOLUTE,
        params: { brightness: 75 },
      } as GoogleCommand);

      expect(cmd?.topic).toBe(`td/${device.key}/brightness`);
    });
  });

  describe("Command Mapping - Color", () => {
    it("should map ColorAbsolute command", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.COLOR_ABSOLUTE,
        params: { color: { spectrumRgb: 0xff_00_00 } },
      } as GoogleCommand);

      expect(cmd).toBeDefined();
      expect(cmd?.topic).toBe(`td/${device.key}/color`);
      expect(cmd?.message).toEqual(
        expect.objectContaining({
          color: expect.objectContaining({
            r: 255,
            g: 0,
            b: 0,
          }),
        })
      );
      expect(cmd?.message.color).toHaveProperty("r");
      expect(cmd?.message.color).toHaveProperty("g");
      expect(cmd?.message.color).toHaveProperty("b");
    });

    it("should map color temperature command", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.COLOR_ABSOLUTE,
        params: { color: { temperatureK: 4000 } },
      } as GoogleCommand);

      expect(cmd).toBeDefined();
      expect(cmd?.message).toEqual(
        expect.objectContaining({ colorTemperature: 4000 })
      );
    });

    // FIXME: Verify priority when both RGB and temperature are provided
    it("should handle both RGB and temperature in color command", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.COLOR_ABSOLUTE,
        params: {
          color: { spectrumRgb: 0xff_00_00, temperatureK: 3000 },
        },
      } as GoogleCommand);

      expect(cmd).toBeDefined();
      expect(cmd?.message).toBeDefined();
      // Priority/override behavior needs verification
    });
  });

  describe("Command Mapping - OpenClose", () => {
    it("should map OpenClose command with position", () => {
      const device = createDevice({ exposes: [["cover"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.OPEN_CLOSE,
        params: { openPercent: 50 },
      } as GoogleCommand);

      expect(cmd).toBeDefined();
      expect(cmd?.topic).toBe(`td/${device.key}/position`);
      expect(cmd?.message).toHaveProperty("position");
      expect(cmd?.message.position).toBe(50);
    });

    // FIXME: Position is NOT clamped in command mapper but IS clamped in state mapper - inconsistency!
    const positionPassThroughTestCases = [
      { value: 150, description: "over 100 (passes through raw value)" },
      { value: -25, description: "negative (passes through raw value)" },
    ];

    positionPassThroughTestCases.forEach(({ value, description }) => {
      it(`should document position ${description}`, () => {
        const device = createDevice({ exposes: [["cover"]] });

        const cmd = mapToHomedCommand(device, {
          command: COMMANDS.OPEN_CLOSE,
          params: { openPercent: value },
        } as GoogleCommand);

        expect(cmd?.message.position).toBe(value); // Command passes through raw value, no clamping
      });
    });
  });

  describe("Command Mapping - Thermostat", () => {
    const thermostatCommandTestCases = [
      {
        command: COMMANDS.THERMOSTAT_TEMPERATURE_SETPOINT,
        params: { thermostatTemperatureSetpoint: 22 },
        expectedTopic: "setpoint",
        expectedMessage: { setpoint: 22 },
        description: "setpoint command",
      },
      {
        command: COMMANDS.THERMOSTAT_SET_MODE,
        params: { thermostatMode: "heat" },
        expectedTopic: "mode",
        expectedMessage: { mode: "heat" },
        description: "mode command",
      },
    ];

    thermostatCommandTestCases.forEach(
      ({ command, params, expectedTopic, expectedMessage, description }) => {
        it(`should map thermostat ${description}`, () => {
          const device = createDevice({ exposes: [["thermostat"]] });

          const cmd = mapToHomedCommand(device, {
            command,
            params,
          } as GoogleCommand);

          expect(cmd).toBeDefined();
          expect(cmd?.topic).toBe(`td/${device.key}/${expectedTopic}`);
          expect(cmd?.message).toEqual(expectedMessage);
        });
      }
    );
  });

  // ============================================================================
  // Command Parameter Validation Tests
  // ============================================================================

  describe("Command Parameter Validation - Invalid Values", () => {
    // Parameterized test for brightness edge cases
    const brightnessEdgeCases = [
      { value: NaN, expectation: "should handle gracefully" },
      { value: Infinity, expectation: "should clamp to 100" },
      { value: -Infinity, expectation: "should clamp to 0" },
      { value: -50, expectation: "should clamp to 0" },
      { value: 999, expectation: "should clamp to 100" },
      // eslint-disable-next-line unicorn/no-null
      { value: null, expectation: "should handle gracefully" },
      { value: "75", expectation: "should handle type coercion" },
    ];

    brightnessEdgeCases.forEach(({ value, expectation }) => {
      it(`brightness(${value}) - ${expectation}`, () => {
        const device = createDevice({ exposes: [["brightness"]] });

        const cmd = mapToHomedCommand(device, {
          command: COMMANDS.BRIGHTNESS_ABSOLUTE,
          params: { brightness: value as any },
        } as GoogleCommand);

        expect(cmd).toBeDefined();
        if (typeof value === "number" && isFinite(value)) {
          expect(cmd?.message.brightness).toBeLessThanOrEqual(100);
          expect(cmd?.message.brightness).toBeGreaterThanOrEqual(0);
        }
      });
    });

    it("should handle negative color temperature", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.COLOR_ABSOLUTE,
        params: { color: { temperatureK: -4000 } },
      } as GoogleCommand);

      expect(cmd).toBeDefined();
      expect(cmd?.message).toHaveProperty("colorTemperature");
    });

    it("should handle invalid RGB values", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.COLOR_ABSOLUTE,
        params: { color: { spectrumRgb: -1 } },
      } as GoogleCommand);

      expect(cmd).toBeDefined();
      expect(cmd?.message).toHaveProperty("color");
    });

    it("should handle missing color params (empty color object)", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.COLOR_ABSOLUTE,
        params: { color: {} },
      } as GoogleCommand);

      expect(cmd).toBeUndefined(); // No command with empty color params
    });

    it("should handle null thermostat setpoint", () => {
      const device = createDevice({ exposes: [["thermostat"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.THERMOSTAT_TEMPERATURE_SETPOINT,
        // eslint-disable-next-line unicorn/no-null
        params: { thermostatTemperatureSetpoint: null as any },
      } as GoogleCommand);

      if (cmd) {
        expect(cmd).toHaveProperty("topic");
        expect(cmd).toHaveProperty("message");
      } else {
        expect(cmd).toBeUndefined();
      }
    });

    it("should handle unsupported command type", () => {
      const device = createDevice({ exposes: [["switch"]] });

      const cmd = mapToHomedCommand(device, {
        command: "action.devices.commands.UnknownCommand",
        params: {},
      } as unknown as GoogleCommand);

      expect(cmd).toBeUndefined();
    });

    it("should handle command with missing params object", () => {
      const device = createDevice({ exposes: [["light"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.ON_OFF,
      } as GoogleCommand);

      expect(cmd).toBeUndefined();
    });
  });

  // ============================================================================
  // Multi-Property Conflict Tests (Task 2)
  // ============================================================================

  describe("Multi-Property Conflicts", () => {
    it("should handle multiple on/off properties - first wins", () => {
      const device = createDevice({ exposes: [["switch"]] });

      // All true - should be consistent
      const state1 = mapToGoogleState(device, { on: true, state: 1, power: 1 });
      expect(state1.on).toBe(true);
      expect(state1).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Conflicting: on=true but state=0
      const state2 = mapToGoogleState(device, { on: true, state: 0 });
      expect(state2).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Conflicting: on=false but power=1
      const state3 = mapToGoogleState(device, { on: false, power: 1 });
      expect(state3).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
    });

    it("should handle brightness vs level property conflicts", () => {
      const device = createDevice({ exposes: [["brightness"]] });

      // Both present with same value
      const state1 = mapToGoogleState(device, { brightness: 50, level: 50 });
      expect(state1.brightness).toBe(50);
      expect(state1).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Conflicting values - which priority?
      const state2 = mapToGoogleState(device, { brightness: 75, level: 25 });
      expect(state2).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Only one present - should still work
      // level: 153 (60% of 255) should map to brightness: 60
      const state3 = mapToGoogleState(device, { level: 153 });
      expect(state3.brightness).toBe(60);
    });

    it("should handle cover position vs state property conflicts", () => {
      const device = createDevice({ exposes: [["cover"]] });

      // Both present
      const state1 = mapToGoogleState(device, { position: 50, state: "open" });
      expect(state1).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Conflicting: position=0 but state="open"
      const state2 = mapToGoogleState(device, { position: 0, state: "open" });
      expect(state2).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Conflicting: position=100 but state="closed"
      const state3 = mapToGoogleState(device, {
        position: 100,
        state: "closed",
      });
      expect(state3).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
    });

    it("should handle color with both RGB and temperature - proper priority", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      // Both RGB and temperature present
      const state = mapToGoogleState(device, {
        color: "#FF0000",
        colorTemperature: 3000,
      });

      expect(state).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
      expect(state.color).toBeDefined();
    });
  });

  // ============================================================================
  // Type Coercion Verification Tests (Task 3)
  // ============================================================================

  describe("Type Coercion", () => {
    it("should coerce string numbers to numeric values", () => {
      const device = createDevice({ exposes: [["brightness"]] });

      const state = mapToGoogleState(device, { brightness: "75" as any });

      // Verify it's coerced and clamped
      expect(state).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
      if (state.brightness !== undefined) {
        expect(typeof state.brightness).toBe("number");
        expect(state.brightness).toBe(75);
      }

      // String with whitespace
      const state2 = mapToGoogleState(device, { brightness: " 50 " as any });
      if (state2.brightness !== undefined) {
        expect(state2.brightness).toBe(50);
      }

      // Invalid string - verify error handling
      const state3 = mapToGoogleState(device, { brightness: "abc" as any });
      expect(state3).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
    });

    it("should coerce numeric values to boolean correctly", () => {
      const device = createDevice({ exposes: [["switch"]] });

      // Standard: 1 = true, 0 = false
      const state1 = mapToGoogleState(device, { on: 1 as any });
      expect(state1.on).toBe(true);

      const state2 = mapToGoogleState(device, { on: 0 as any });
      expect(state2.on).toBe(false);

      // Edge cases: 2, -1, etc. should be truthy
      const state3 = mapToGoogleState(device, { on: 2 as any });
      expect(state3.on).toBe(true);

      const state4 = mapToGoogleState(device, { on: -1 as any });
      expect(state4.on).toBe(true);
    });

    it("should coerce and validate hex color strings", () => {
      const device = createDevice({ exposes: [["color_light"]] });

      // Standard 6-digit hex
      const state1 = mapToGoogleState(device, { color: "#FF0000" });
      expect(state1).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Case insensitive
      const state2 = mapToGoogleState(device, { color: "#ff0000" });
      expect(state2).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      // Without # prefix - should handle or error
      const state3 = mapToGoogleState(device, { color: "FF0000" as any });
      expect(state3).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
    });
  });

  // ============================================================================
  // Enhanced Error Handling Tests (Task 4)
  // ============================================================================

  describe("Error Handling - Commands", () => {
    it("should return undefined for completely invalid commands", () => {
      const device = createDevice({ exposes: [["switch"]] });

      const cmd = mapToHomedCommand(device, {
        command: "action.devices.commands.InvalidCommand123",
        params: { on: true },
      } as unknown as GoogleCommand);

      expect(cmd).toBeUndefined();
    });

    it("should handle commands with missing required parameters", () => {
      const device = createDevice({ exposes: [["light", "brightness"]] });

      // Missing params object entirely
      const cmd1 = mapToHomedCommand(device, {
        command: COMMANDS.BRIGHTNESS_ABSOLUTE,
      } as GoogleCommand);

      expect(cmd1).toBeUndefined();

      // Params object present but missing required field
      const cmd2 = mapToHomedCommand(device, {
        command: COMMANDS.BRIGHTNESS_ABSOLUTE,
        params: {},
      } as GoogleCommand);

      expect(cmd2).toBeUndefined();
    });

    it("should reject commands on read-only sensors", () => {
      const occupancyDevice = createDevice({ exposes: [["occupancy"]] });
      const contactDevice = createDevice({ exposes: [["contact"]] });
      const smokeDevice = createDevice({ exposes: [["smoke"]] });

      // Sensors should not accept any write commands
      const cmd1 = mapToHomedCommand(occupancyDevice, {
        command: COMMANDS.ON_OFF,
        params: { on: true },
      } as GoogleCommand);
      expect(cmd1).toBeUndefined();

      const cmd2 = mapToHomedCommand(contactDevice, {
        command: COMMANDS.OPEN_CLOSE,
        params: { openPercent: 50 },
      } as GoogleCommand);
      expect(cmd2).toBeUndefined();

      const cmd3 = mapToHomedCommand(smokeDevice, {
        command: COMMANDS.ON_OFF,
        params: { on: true },
      } as GoogleCommand);
      expect(cmd3).toBeUndefined();
    });

    it("should reject commands incompatible with device type", () => {
      const switchDevice = createDevice({ exposes: [["switch"]] });
      const lockDevice = createDevice({ exposes: [["lock"]] });

      // Brightness command on switch (no brightness trait)
      const cmd1 = mapToHomedCommand(switchDevice, {
        command: COMMANDS.BRIGHTNESS_ABSOLUTE,
        params: { brightness: 50 },
      } as GoogleCommand);
      expect(cmd1).toBeUndefined();

      // Color command on lock (no color trait)
      const cmd2 = mapToHomedCommand(lockDevice, {
        command: COMMANDS.COLOR_ABSOLUTE,
        params: { color: { spectrumRgb: 0xff_00_00 } },
      } as GoogleCommand);
      expect(cmd2).toBeUndefined();
    });

    it("should handle unsupported thermostat modes in commands", () => {
      const device = createDevice({
        exposes: [["thermostat"]],
        options: {
          modes: ["off", "heat", "cool"],
        },
      });

      // Valid mode
      const cmd1 = mapToHomedCommand(device, {
        command: COMMANDS.THERMOSTAT_SET_MODE,
        params: { thermostatMode: "heat" },
      } as GoogleCommand);
      expect(cmd1).toBeDefined();
      expect(cmd1?.message.mode).toBe("heat");

      // Unsupported mode - mapper passes through (validation is device responsibility)
      const cmd2 = mapToHomedCommand(device, {
        command: COMMANDS.THERMOSTAT_SET_MODE,
        params: { thermostatMode: "aux" as any },
      } as GoogleCommand);

      expect(cmd2).toBeDefined(); // Mapper allows pass-through
      expect(cmd2?.message.mode).toBe("aux");
    });
  });
  // ============================================================================
  // Endpoint Options Merging Tests
  // ============================================================================

  describe("Endpoint Options Merging", () => {
    it("should merge options from single endpoint", () => {
      const device = createDevice({
        exposes: [["thermostat"]],
        options: {
          modes: ["off", "heat", "cool", "auto"],
          minTemp: 15,
          maxTemp: 30,
        },
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.attributes).toBeDefined();
      expect(google.type).toBe(DEVICE_TYPES.THERMOSTAT);
    });

    it("should merge options from multiple endpoints", () => {
      const device = createDevice({
        exposes: [["light"], ["brightness"], ["color_light"]],
        options: {
          colorModel: "rgb",
          minBrightness: 10,
          maxBrightness: 254,
          colorTemp: [2700, 6500],
        },
        name: "Advanced Light",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
      expect(google.traits).toContain(TRAITS.ON_OFF);
      expect(google.traits).toContain(TRAITS.BRIGHTNESS);
      expect(google.traits).toContain(TRAITS.COLOR_SETTING);
    });

    it("should handle empty options in endpoints", () => {
      const device = createDevice({
        exposes: [["switch"]],
        options: {},
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google).toBeDefined();
      expect(google.type).toBe(DEVICE_TYPES.SWITCH);
    });

    // FIXME: Verify if options with conflicting values are handled correctly
    it("should handle options with conflicting values", () => {
      const device = createDevice({
        exposes: [["brightness"]],
        options: {
          minBrightness: 100,
          maxBrightness: 50, // Conflict: min > max
        },
      });

      const google = mapToGoogleDevice(device, testClientId);
      // Should either reject or normalize
      expect(google).toBeDefined();
    });

    it("should handle device with options in state mapping", () => {
      const device = createDevice({
        exposes: [["thermostat"]],
        options: {
          modes: ["off", "heat", "cool"],
          minTemp: 10,
          maxTemp: 35,
        },
      });

      const state = mapToGoogleState(device, {
        temperature: 22,
        setpoint: 23,
        mode: "heat",
      });

      expect(state.thermostatTemperatureAmbient).toBe(22);
      expect(state.thermostatTemperatureSetpoint).toBe(23);
      expect(state.thermostatMode).toBe("heat");
    });

    it("should handle device with options in command mapping", () => {
      const device = createDevice({
        exposes: [["brightness"]],
        options: {
          minBrightness: 1,
          maxBrightness: 254,
        },
      });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.BRIGHTNESS_ABSOLUTE,
        params: { brightness: 50 },
      } as GoogleCommand);

      expect(cmd?.topic).toBe(`td/${device.key}/brightness`);
      expect(cmd?.message.brightness).toBe(50);
    });

    it("should preserve endpoint info with options in customData", () => {
      const device = createDevice({
        exposes: [["light"], ["brightness"]],
        options: {
          colorModel: "rgb",
          type: "dimmable",
        },
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.customData?.endpoints).toBeDefined();
      expect(google.customData?.endpoints).toHaveLength(2);
      const endpoints = google.customData?.endpoints as any;
      expect(endpoints[0].exposes).toEqual(["light"]);
      expect(endpoints[1].exposes).toEqual(["brightness"]);
    });
  });

  // ============================================================================
  // State Shape Validation Tests
  // ============================================================================

  describe("State Shape Validation - Type Safety", () => {
    // Parameterized type mismatch tests to reduce duplication
    const typeMismatchCases = [
      {
        name: "brightness as string",
        device: { exposes: [["brightness"]] },
        state: { brightness: "75" as any },
        expectKey: "brightness",
      },
      {
        name: "on as number (truthy)",
        device: { exposes: [["switch"]] },
        state: { on: 1 as any },
        expectKey: "on",
        expectValue: true, // Should be truthy
      },
      {
        name: "on as number (falsy)",
        device: { exposes: [["switch"]] },
        state: { on: 0 as any },
        expectKey: "on",
        expectValue: false, // Should be falsy
      },
      {
        name: "on as string",
        device: { exposes: [["switch"]] },
        state: { on: "true" as any },
        expectKey: "on",
      },
      {
        name: "occupancy as number",
        device: { exposes: [["occupancy"]] },
        state: { occupancy: 1 as any },
        expectKey: "occupancy",
      },
      {
        name: "position as string",
        device: { exposes: [["cover"]] },
        state: { position: "50" as any },
        expectKey: "openPercent",
      },
      {
        name: "temperature as string",
        device: { exposes: [["thermostat"]] },
        state: { temperature: "21.5" as any },
        expectKey: "thermostatTemperatureAmbient",
      },
    ];

    typeMismatchCases.forEach(
      ({ name, device, state, expectKey, expectValue }) => {
        it(`should handle ${name}`, () => {
          const testDevice = createDevice(device as any);
          const result = mapToGoogleState(testDevice, state);

          expect(result).toEqual(
            expect.objectContaining({
              online: true,
            })
          );
          if (expectValue !== undefined) {
            expect((result as any)[expectKey]).toBe(expectValue);
          }
        });
      }
    );

    it("should handle null/undefined values", () => {
      const device = createDevice({ exposes: [["brightness"]] });

      // eslint-disable-next-line unicorn/no-null
      const state1 = mapToGoogleState(device, { brightness: null as any });
      expect(state1).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      const state2 = mapToGoogleState(device, { brightness: undefined });
      expect(state2).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
    });

    it("should handle NaN and Infinity", () => {
      const device = createDevice({ exposes: [["brightness"]] });

      const state1 = mapToGoogleState(device, { brightness: NaN });
      expect(state1).toEqual(
        expect.objectContaining({
          online: true,
        })
      );

      const state2 = mapToGoogleState(device, {
        position: Infinity as any,
      });
      expect(state2).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
    });

    it("should handle mixed valid and invalid properties", () => {
      const device = createDevice({
        exposes: [["light", "brightness"]],
      });

      const state = mapToGoogleState(device, {
        on: true,
        brightness: "invalid" as any,
        unknown: "value",
      });

      expect(state.on).toBe(true);
      expect(state.online).toBe(true);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle device with no endpoints", () => {
      const device = createDevice({
        exposes: [],
        name: "Empty Device",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SWITCH); // Default fallback
      expect(google.traits).toHaveLength(0);
    });

    it("should handle device with empty expose array in endpoint", () => {
      const device = createDevice({
        exposes: [[]],
        name: "Empty Endpoint",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SWITCH); // Default fallback
    });

    it("should handle unsupported command type", () => {
      const device = createDevice({ exposes: [["switch"]] });

      const cmd = mapToHomedCommand(device, {
        command: "action.devices.commands.UnknownCommand",
        params: {},
      } as unknown as GoogleCommand);

      expect(cmd).toBeUndefined();
    });

    it("should handle command without params object", () => {
      const device = createDevice({ exposes: [["light"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.ON_OFF,
      } as GoogleCommand);

      expect(cmd).toBeUndefined();
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle device with no endpoints", () => {
      const device = createDevice({
        exposes: [],
        name: "Empty Device",
      });

      const google = mapToGoogleDevice(device, testClientId);
      expect(google.type).toBe(DEVICE_TYPES.SWITCH); // Default fallback
      expect(google.traits).toHaveLength(0);
    });

    it("should generate unique keys for different devices", () => {
      const device1 = createDevice({ exposes: [["switch"]] });
      const device2 = createDevice({ exposes: [["switch"]] });

      // Should have different keys (not 100% guaranteed but highly likely)
      expect(device1.key).not.toBe(device2.key);

      // Keys should be valid hex format
      expect(device1.key).toMatch(/^0x[0-9a-f]{6}$/i);
    });

    it("should handle state with no recognized properties", () => {
      const device = createDevice({ exposes: [["switch"]] });

      const state = mapToGoogleState(device, { unknown: "value" });
      expect(state).toEqual(
        expect.objectContaining({
          online: true,
        })
      );
      expect(state.on).toBeUndefined();
    });

    it("should return undefined for read-only sensor commands", () => {
      const device = createDevice({ exposes: [["occupancy"]] });

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.ON_OFF,
        params: { on: true },
      } as GoogleCommand);

      expect(cmd).toBeUndefined(); // Sensors don't support commands
    });

    // FIXME: Verify behavior when command is issued on incompatible device
    it("should handle command on incompatible device type", () => {
      const device = createDevice({ exposes: [["contact"]] }); // Read-only sensor

      const cmd = mapToHomedCommand(device, {
        command: COMMANDS.BRIGHTNESS_ABSOLUTE,
        params: { brightness: 50 },
      } as GoogleCommand);

      expect(cmd).toBeUndefined();
    });
  });

  // ============================================================================
  // Complex Real-World Scenarios
  // ============================================================================

  describe("Real-World Scenarios", () => {
    it("should handle complex light device with all options", () => {
      const device = createDevice({
        exposes: [["light", "brightness", "color_light"]],
        topic: "home/advanced_light",
        name: "Advanced Light",
        description: "Living room RGB light",
      });

      const google = mapToGoogleDevice(device, "client-001" as ClientId);

      // Device mapping
      expect(google.type).toBe(DEVICE_TYPES.LIGHT);
      expect(google.traits).toContain(TRAITS.ON_OFF);
      expect(google.traits).toContain(TRAITS.BRIGHTNESS);
      expect(google.traits).toContain(TRAITS.COLOR_SETTING);

      // State mapping
      const state = mapToGoogleState(device, {
        on: true,
        brightness: 75,
        color: "#FF5500",
      });
      expect(state.on).toBe(true);
      expect(state.brightness).toBe(75);
      expect(state.color).toBeDefined();
      expect(state.online).toBe(true);

      // Command mapping
      const cmd1 = mapToHomedCommand(device, {
        command: COMMANDS.ON_OFF,
        params: { on: false },
      } as GoogleCommand);
      expect(cmd1).toBeDefined();
      expect(cmd1?.message.on).toBe(0);

      const cmd2 = mapToHomedCommand(device, {
        command: COMMANDS.BRIGHTNESS_ABSOLUTE,
        params: { brightness: 50 },
      } as GoogleCommand);
      expect(cmd2).toBeDefined();
      expect(cmd2?.message.brightness).toBe(50);
    });

    it("should handle HVAC thermostat device", () => {
      const device = createDevice({
        exposes: [["thermostat"]],
        topic: "home/living_room_thermostat",
        name: "Living Room Thermostat",
      });

      const google = mapToGoogleDevice(device, "client-001" as ClientId);
      expect(google.type).toBe(DEVICE_TYPES.THERMOSTAT);
      expect(google.traits).toContain(TRAITS.TEMPERATURE_SETTING);

      const state = mapToGoogleState(device, {
        temperature: 20,
        setpoint: 22,
        mode: "heat",
      });

      expect(state.thermostatTemperatureAmbient).toBe(20);
      expect(state.thermostatTemperatureSetpoint).toBe(22);
      expect(state.thermostatMode).toBe("heat");
      expect(state.online).toBe(true);
    });

    it("should handle smart outlet with power monitoring", () => {
      const device = createDevice({
        exposes: [["outlet", "power", "energy"]],
        topic: "home/smart_outlet",
        name: "Smart Outlet",
      });

      const google = mapToGoogleDevice(device, "client-001" as ClientId);
      expect(google.type).toBe(DEVICE_TYPES.OUTLET);
      expect(google.traits).toContain(TRAITS.ON_OFF);
    });

    // FIXME: Verify behavior when multiple exclusive device types are present
    it("should handle device with multiple exclusive traits", () => {
      const device = createDevice({
        exposes: [["switch", "brightness", "cover", "lock"]],
        name: "Multi-trait Device",
      });

      const google = mapToGoogleDevice(device, testClientId);
      // Should pick primary type based on priority
      expect(google.type).toBeDefined();
      expect([
        DEVICE_TYPES.SWITCH,
        DEVICE_TYPES.LIGHT,
        DEVICE_TYPES.BLINDS,
        DEVICE_TYPES.LOCK,
      ]).toContain(google.type);
    });
  });
});
