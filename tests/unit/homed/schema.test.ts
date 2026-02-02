import { describe, expect, it } from "vitest";
import {
  ZigbeeDeviceInfoSchema,
  ClientStatusMessageSchema,
} from "../../../src/homed/schema.ts";

describe("ZigbeeDeviceInfoSchema", () => {
  describe("version field", () => {
    it("should accept string version", () => {
      const data = {
        ieeeAddress: "00:12:4b:00:25:9a:ee:e4",
        version: "3.0.1",
      };

      const result = ZigbeeDeviceInfoSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe("3.0.1");
      }
    });

    it("should coerce numeric version to string", () => {
      const data = {
        ieeeAddress: "00:12:4b:00:25:9a:ee:e4",
        version: 17,
      };

      const result = ZigbeeDeviceInfoSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe("17");
        expect(typeof result.data.version).toBe("string");
      }
    });

    it("should accept missing version field", () => {
      const data = {
        ieeeAddress: "00:12:4b:00:25:9a:ee:e4",
      };

      const result = ZigbeeDeviceInfoSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBeUndefined();
      }
    });
  });
});

describe("ClientStatusMessageSchema", () => {
  it("should parse devices with numeric version fields", () => {
    const data = {
      devices: [
        {
          ieeeAddress: "00:12:4b:00:25:9a:ee:e4",
          name: "Coordinator",
          version: 0,
        },
        {
          ieeeAddress: "04:cf:8c:df:3c:7c:3b:97",
          name: "Switch",
          version: 17,
        },
        {
          ieeeAddress: "84:fd:27:ff:fe:75:bf:44",
          name: "Bulb",
          version: 32,
        },
      ],
      timestamp: 1770057929,
    };

    const result = ClientStatusMessageSchema.safeParse(data);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.devices).toHaveLength(3);
      expect(result.data.devices?.[0].version).toBe("0");
      expect(result.data.devices?.[1].version).toBe("17");
      expect(result.data.devices?.[2].version).toBe("32");
    }
  });
});
