/**
 * Mapper Service Unit Tests
 */

import {
  CapabilityMapper,
  type HomedDevice,
} from "../../src/schemas/services/mapper.service.ts";
import type { GoogleCommand } from "../../src/types/googleSmarthome.ts";

describe("CapabilityMapper", () => {
  let mapper: CapabilityMapper;

  beforeEach(() => {
    mapper = new CapabilityMapper();
  });

  // ============================================================================
  // Device Type Detection Tests
  // ============================================================================

  describe("Device Type Detection", () => {
    it("should map switch device to SWITCH type", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Main Switch",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["switch"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.SWITCH");
      expect(google.traits).toContain("action.devices.traits.OnOff");
    });

    it("should map outlet device to OUTLET type", () => {
      const device: HomedDevice = {
        key: "0x002",
        name: "Power Outlet",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["outlet"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.OUTLET");
    });

    it("should map light device to LIGHT type", () => {
      const device: HomedDevice = {
        key: "0x003",
        name: "Ceiling Light",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["light"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.LIGHT");
    });

    it("should map dimmable light with brightness trait", () => {
      const device: HomedDevice = {
        key: "0x004",
        name: "Dimmable Light",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["light", "brightness"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.LIGHT");
      expect(google.traits).toContain("action.devices.traits.OnOff");
      expect(google.traits).toContain("action.devices.traits.Brightness");
    });

    it("should map color light with color trait", () => {
      const device: HomedDevice = {
        key: "0x005",
        name: "RGB Light",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["light", "brightness", "color_light"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.traits).toContain("action.devices.traits.OnOff");
      expect(google.traits).toContain("action.devices.traits.Brightness");
      expect(google.traits).toContain("action.devices.traits.ColorSetting");
    });

    it("should map cover device to BLINDS type", () => {
      const device: HomedDevice = {
        key: "0x006",
        name: "Window Blinds",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["cover"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.BLINDS");
      expect(google.traits).toContain("action.devices.traits.OpenClose");
    });

    it("should map lock device to LOCK type", () => {
      const device: HomedDevice = {
        key: "0x007",
        name: "Door Lock",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["lock"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.LOCK");
      expect(google.traits).toContain("action.devices.traits.OnOff");
    });

    it("should map thermostat device to THERMOSTAT type", () => {
      const device: HomedDevice = {
        key: "0x008",
        name: "Smart Thermostat",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["thermostat"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.THERMOSTAT");
      expect(google.traits).toContain(
        "action.devices.traits.TemperatureSetting"
      );
    });

    it("should map smoke detector to SMOKE_DETECTOR type", () => {
      const device: HomedDevice = {
        key: "0x009",
        name: "Smoke Detector",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["smoke"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.SMOKE_DETECTOR");
    });

    it("should map contact sensor to SENSOR type", () => {
      const device: HomedDevice = {
        key: "0x00A",
        name: "Door Contact",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["contact"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.SENSOR");
      expect(google.traits).toContain("action.devices.traits.SensorState");
    });

    it("should map occupancy sensor to SENSOR type", () => {
      const device: HomedDevice = {
        key: "0x00B",
        name: "Motion Sensor",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["occupancy"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.SENSOR");
      expect(google.traits).toContain("action.devices.traits.SensorState");
    });

    it("should map water leak sensor to SENSOR type", () => {
      const device: HomedDevice = {
        key: "0x00C",
        name: "Water Leak Sensor",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["water_leak"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.SENSOR");
    });
  });

  // ============================================================================
  // Device Mapping Tests
  // ============================================================================

  describe("Device Mapping", () => {
    it("should map device with all required fields", () => {
      const device: HomedDevice = {
        key: "0x123456",
        name: "Living Room Light",
        description: "Main light",
        available: true,
        type: "light",
        endpoints: [
          {
            id: 1,
            name: "Power",
            exposes: ["light", "brightness"],
            options: {},
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client-001");

      expect(google.id).toBe("client-001-0x123456");
      expect(google.name.name).toBe("Living Room Light");
      expect(google.name.defaultNames).toContain("Living Room Light");
      expect(google.name.nicknames).toContain("Main light");
      expect(google.willReportState).toBe(true);
      expect(google.deviceInfo?.manufacturer).toBe("Homed");
      expect(google.customData?.homedKey).toBe("0x123456");
    });

    it("should handle device without description", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Simple Switch",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["switch"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.name.nicknames.length).toBe(0);
    });

    it("should handle multiple endpoints", () => {
      const device: HomedDevice = {
        key: "0x002",
        name: "Multi-endpoint Device",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["light"],
          },
          {
            id: 2,
            exposes: ["brightness"],
          },
          {
            id: 3,
            exposes: ["color_light"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.traits).toContain("action.devices.traits.OnOff");
      expect(google.traits).toContain("action.devices.traits.Brightness");
      expect(google.traits).toContain("action.devices.traits.ColorSetting");
    });

    it("should deduplicate exposes from multiple endpoints", () => {
      const device: HomedDevice = {
        key: "0x003",
        name: "Device with duplicate exposes",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["switch", "power"],
          },
          {
            id: 2,
            exposes: ["switch", "energy"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      // Should have traits but switch should not be duplicated
      expect(google.traits.length).toBeGreaterThan(0);
    });

    it("should store endpoint info in customData", () => {
      const device: HomedDevice = {
        key: "0x004",
        name: "Device",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["light"],
          },
          {
            id: 2,
            exposes: ["brightness"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.customData?.endpoints).toHaveLength(2);
      expect(google.customData?.endpoints[0].id).toBe(1);
      expect(google.customData?.endpoints[1].id).toBe(2);
    });
  });

  // ============================================================================
  // State Mapping Tests
  // ============================================================================

  describe("State Mapping - OnOff Trait", () => {
    it("should map on/off state with 'on' property", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Switch",
        available: true,
        endpoints: [{ id: 1, exposes: ["switch"] }],
      };

      const state = mapper.mapToGoogleState(device, { on: true });
      expect(state.on).toBe(true);
      expect(state.online).toBe(true);

      const state2 = mapper.mapToGoogleState(device, { on: false });
      expect(state2.on).toBe(false);
    });

    it("should map on/off state with 'state' property", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Switch",
        available: true,
        endpoints: [{ id: 1, exposes: ["switch"] }],
      };

      const state = mapper.mapToGoogleState(device, { state: 1 });
      expect(state.on).toBe(true);

      const state2 = mapper.mapToGoogleState(device, { state: 0 });
      expect(state2.on).toBe(false);
    });

    it("should map on/off state with 'power' property", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Switch",
        available: true,
        endpoints: [{ id: 1, exposes: ["switch"] }],
      };

      const state = mapper.mapToGoogleState(device, { power: 1 });
      expect(state.on).toBe(true);
    });

    it("should reflect offline status", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Switch",
        available: false,
        endpoints: [{ id: 1, exposes: ["switch"] }],
      };

      const state = mapper.mapToGoogleState(device, { on: true });
      expect(state.online).toBe(false);
    });
  });

  describe("State Mapping - Brightness Trait", () => {
    it("should map brightness state (0-100)", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Dimmable Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["light", "brightness"] }],
      };

      const state = mapper.mapToGoogleState(device, { brightness: 75 });
      expect(state.brightness).toBe(75);
    });

    it("should clamp brightness to 0-100 range", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Dimmable Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["brightness"] }],
      };

      const state1 = mapper.mapToGoogleState(device, { brightness: 150 });
      expect(state1.brightness).toBe(100);

      const state2 = mapper.mapToGoogleState(device, { brightness: -10 });
      expect(state2.brightness).toBe(0);
    });

    it("should map brightness with 'level' property", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Dimmable Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["brightness"] }],
      };

      const state = mapper.mapToGoogleState(device, { level: 50 });
      expect(state.brightness).toBe(50);
    });
  });

  describe("State Mapping - Color Trait", () => {
    it("should map RGB color from hex format", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "RGB Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["color_light"] }],
      };

      const state = mapper.mapToGoogleState(device, { color: "#FF0000" });
      expect(state.color?.spectrumRgb).toBeDefined();
    });

    it("should map color temperature", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Color Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["color_light"] }],
      };

      const state = mapper.mapToGoogleState(device, { colorTemperature: 4000 });
      expect(state.color?.temperatureK).toBe(4000);
    });

    it("should handle missing color data", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["light"] }],
      };

      const state = mapper.mapToGoogleState(device, { brightness: 100 });
      expect(state.color).toBeUndefined();
    });
  });

  describe("State Mapping - OpenClose Trait", () => {
    it("should map cover position (0-100)", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Blinds",
        available: true,
        endpoints: [{ id: 1, exposes: ["cover"] }],
      };

      const state = mapper.mapToGoogleState(device, { position: 50 });
      expect(state.openPercent).toBe(50);
    });

    it("should clamp cover position to 0-100 range", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Blinds",
        available: true,
        endpoints: [{ id: 1, exposes: ["cover"] }],
      };

      const state1 = mapper.mapToGoogleState(device, { position: 150 });
      expect(state1.openPercent).toBe(100);

      const state2 = mapper.mapToGoogleState(device, { position: -10 });
      expect(state2.openPercent).toBe(0);
    });

    it("should map cover state from string values", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Blinds",
        available: true,
        endpoints: [{ id: 1, exposes: ["cover"] }],
      };

      const state1 = mapper.mapToGoogleState(device, { state: "open" });
      expect(state1.openPercent).toBe(100);

      const state2 = mapper.mapToGoogleState(device, { state: "closed" });
      expect(state2.openPercent).toBe(0);
    });
  });

  describe("State Mapping - TemperatureSetting Trait", () => {
    it("should map ambient temperature", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Thermostat",
        available: true,
        endpoints: [{ id: 1, exposes: ["thermostat"] }],
      };

      const state = mapper.mapToGoogleState(device, { temperature: 21.5 });
      expect(state.thermostatTemperatureAmbient).toBe(21.5);
    });

    it("should map temperature setpoint", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Thermostat",
        available: true,
        endpoints: [{ id: 1, exposes: ["thermostat"] }],
      };

      const state = mapper.mapToGoogleState(device, { setpoint: 22 });
      expect(state.thermostatTemperatureSetpoint).toBe(22);
    });

    it("should map thermostat mode", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Thermostat",
        available: true,
        endpoints: [{ id: 1, exposes: ["thermostat"] }],
      };

      const state = mapper.mapToGoogleState(device, { mode: "heat" });
      expect(state.thermostatMode).toBe("heat");
    });

    it("should map multiple thermostat properties together", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Thermostat",
        available: true,
        endpoints: [{ id: 1, exposes: ["thermostat"] }],
      };

      const state = mapper.mapToGoogleState(device, {
        temperature: 20,
        setpoint: 22,
        mode: "heat",
      });
      expect(state.thermostatTemperatureAmbient).toBe(20);
      expect(state.thermostatTemperatureSetpoint).toBe(22);
      expect(state.thermostatMode).toBe("heat");
    });
  });

  describe("State Mapping - Sensor Trait", () => {
    it("should map occupancy sensor state", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Motion Sensor",
        available: true,
        endpoints: [{ id: 1, exposes: ["occupancy"] }],
      };

      const state1 = mapper.mapToGoogleState(device, { occupancy: true });
      expect(state1.occupancy).toBe("OCCUPIED");

      const state2 = mapper.mapToGoogleState(device, { occupancy: false });
      expect(state2.occupancy).toBe("UNOCCUPIED");
    });

    it("should map contact sensor state", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Door Sensor",
        available: true,
        endpoints: [{ id: 1, exposes: ["contact"] }],
      };

      const state1 = mapper.mapToGoogleState(device, { contact: true });
      expect(state1.openclose).toBe("OPEN");

      const state2 = mapper.mapToGoogleState(device, { contact: false });
      expect(state2.openclose).toBe("CLOSED");
    });

    it("should map smoke detector state", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Smoke Detector",
        available: true,
        endpoints: [{ id: 1, exposes: ["smoke"] }],
      };

      const state1 = mapper.mapToGoogleState(device, { smoke: true });
      expect(state1.smoke).toBe("SMOKE");

      const state2 = mapper.mapToGoogleState(device, { smoke: false });
      expect(state2.smoke).toBe("NO_SMOKE");
    });

    it("should map water leak sensor state", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Water Sensor",
        available: true,
        endpoints: [{ id: 1, exposes: ["water_leak"] }],
      };

      const state1 = mapper.mapToGoogleState(device, { waterLeak: true });
      expect(state1.waterleak).toBe("LEAK");

      const state2 = mapper.mapToGoogleState(device, { waterLeak: false });
      expect(state2.waterleak).toBe("NO_LEAK");
    });
  });

  // ============================================================================
  // Command Mapping Tests
  // ============================================================================

  describe("Command Mapping - OnOff", () => {
    it("should map OnOff command to device topic", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Switch",
        available: true,
        endpoints: [{ id: 1, exposes: ["switch"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.OnOff",
        params: { on: true },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd?.topic).toBe("td/0x001/switch");
      expect(homedCmd?.message.on).toBe(1);
    });

    it("should handle OnOff off command", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Switch",
        available: true,
        endpoints: [{ id: 1, exposes: ["switch"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.OnOff",
        params: { on: false },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd?.message.on).toBe(0);
    });
  });

  describe("Command Mapping - Brightness", () => {
    it("should map BrightnessAbsolute command", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["light", "brightness"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.BrightnessAbsolute",
        params: { brightness: 75 },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd?.topic).toBe("td/0x001/brightness");
      expect(homedCmd?.message.brightness).toBe(75);
    });

    it("should clamp brightness to 0-100", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["brightness"] }],
      };

      const command1: GoogleCommand = {
        command: "action.devices.commands.BrightnessAbsolute",
        params: { brightness: 150 },
      };

      const homedCmd1 = mapper.mapToHomedCommand(device, command1);
      expect(homedCmd1?.message.brightness).toBe(100);

      const command2: GoogleCommand = {
        command: "action.devices.commands.BrightnessAbsolute",
        params: { brightness: -10 },
      };

      const homedCmd2 = mapper.mapToHomedCommand(device, command2);
      expect(homedCmd2?.message.brightness).toBe(0);
    });
  });

  describe("Command Mapping - Color", () => {
    it("should map color RGB command", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["color_light"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.ColorAbsolute",
        params: { color: { spectrumRgb: 0xff_00_00 } },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd?.topic).toBe("td/0x001/color");
      expect(homedCmd?.message.color?.r).toBe(255);
      expect(homedCmd?.message.color?.g).toBe(0);
      expect(homedCmd?.message.color?.b).toBe(0);
    });

    it("should map color temperature command", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["color_light"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.ColorAbsolute",
        params: { color: { temperatureK: 4000 } },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd?.message.colorTemperature).toBe(4000);
    });
  });

  describe("Command Mapping - OpenClose", () => {
    it("should map OpenClose command with position", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Blinds",
        available: true,
        endpoints: [{ id: 1, exposes: ["cover"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.OpenClose",
        params: { openPercent: 50 },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd?.topic).toBe("td/0x001/position");
      expect(homedCmd?.message.position).toBe(50);
    });
  });

  describe("Command Mapping - Temperature", () => {
    it("should map ThermostatTemperatureSetpoint command", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Thermostat",
        available: true,
        endpoints: [{ id: 1, exposes: ["thermostat"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.ThermostatTemperatureSetpoint",
        params: { thermostatTemperatureSetpoint: 22 },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd?.topic).toBe("td/0x001/setpoint");
      expect(homedCmd?.message.setpoint).toBe(22);
    });

    it("should map ThermostatSetMode command", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Thermostat",
        available: true,
        endpoints: [{ id: 1, exposes: ["thermostat"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.ThermostatSetMode",
        params: { thermostatMode: "heat" },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd?.topic).toBe("td/0x001/mode");
      expect(homedCmd?.message.mode).toBe("heat");
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle device with no endpoints", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Empty Device",
        available: true,
        endpoints: [],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.SWITCH"); // Default fallback
      expect(google.traits).toHaveLength(0);
    });

    it("should handle device with empty exposes", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Empty Endpoint",
        available: true,
        endpoints: [{ id: 1, exposes: [] }],
      };

      const google = mapper.mapToGoogleDevice(device, "client1");
      expect(google.type).toBe("action.devices.types.SWITCH"); // Default fallback
    });

    it("should handle unsupported command", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Switch",
        available: true,
        endpoints: [{ id: 1, exposes: ["switch"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.UnknownCommand",
        params: {},
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd).toBeUndefined();
    });

    it("should handle command without params", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Light",
        available: true,
        endpoints: [{ id: 1, exposes: ["light"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.OnOff",
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd).toBeUndefined();
    });

    it("should handle state with no recognized properties", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Device",
        available: true,
        endpoints: [{ id: 1, exposes: ["switch"] }],
      };

      const state = mapper.mapToGoogleState(device, { unknown: "value" });
      expect(state.online).toBe(true);
      expect(state.status).toBe("SUCCESS");
      expect(state.on).toBeUndefined();
    });

    it("should handle state for read-only sensor", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Motion Sensor",
        available: true,
        endpoints: [{ id: 1, exposes: ["occupancy"] }],
      };

      const command: GoogleCommand = {
        command: "action.devices.commands.OnOff",
        params: { on: true },
      };

      const homedCmd = mapper.mapToHomedCommand(device, command);
      expect(homedCmd).toBeUndefined(); // Sensors don't support commands
    });
  });

  // ============================================================================
  // Complex Real-World Scenarios
  // ============================================================================

  describe("Real-World Scenarios", () => {
    it("should handle complex light device with all options", () => {
      const device: HomedDevice = {
        key: "0x001",
        name: "Advanced Light",
        description: "Living room RGB light",
        available: true,
        type: "color_light",
        endpoints: [
          {
            id: 1,
            name: "Light",
            exposes: ["light", "brightness", "color_light"],
            options: {
              colorModel: "rgb",
            },
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client-001");

      // Should support all traits
      expect(google.traits).toContain("action.devices.traits.OnOff");
      expect(google.traits).toContain("action.devices.traits.Brightness");
      expect(google.traits).toContain("action.devices.traits.ColorSetting");

      // Should map all state changes
      const state = mapper.mapToGoogleState(device, {
        on: true,
        brightness: 75,
        color: "#FF5500",
      });
      expect(state.on).toBe(true);
      expect(state.brightness).toBe(75);
      expect(state.color).toBeDefined();

      // Should handle all commands
      const cmd1 = mapper.mapToHomedCommand(device, {
        command: "action.devices.commands.OnOff",
        params: { on: false },
      });
      expect(cmd1).toBeDefined();

      const cmd2 = mapper.mapToHomedCommand(device, {
        command: "action.devices.commands.BrightnessAbsolute",
        params: { brightness: 50 },
      });
      expect(cmd2).toBeDefined();
    });

    it("should handle HVAC thermostat device", () => {
      const device: HomedDevice = {
        key: "0x002",
        name: "Living Room Thermostat",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["thermostat"],
            options: {
              modes: ["off", "heat", "cool", "auto"],
            },
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client-001");
      expect(google.type).toBe("action.devices.types.THERMOSTAT");
      expect(google.attributes?.availableThermostatModes).toContain("heat");

      const state = mapper.mapToGoogleState(device, {
        temperature: 20,
        setpoint: 22,
        mode: "heat",
      });

      expect(state.thermostatTemperatureAmbient).toBe(20);
      expect(state.thermostatTemperatureSetpoint).toBe(22);
      expect(state.thermostatMode).toBe("heat");
    });

    it("should handle smart outlet with power monitoring", () => {
      const device: HomedDevice = {
        key: "0x003",
        name: "Smart Outlet",
        available: true,
        endpoints: [
          {
            id: 1,
            exposes: ["outlet", "power", "energy"],
          },
        ],
      };

      const google = mapper.mapToGoogleDevice(device, "client-001");
      expect(google.type).toBe("action.devices.types.OUTLET");
    });
  });
});
