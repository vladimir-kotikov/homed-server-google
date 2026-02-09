/* eslint-disable unicorn/no-null */
import { describe, expect, it } from "vitest";
import { fastDeepEqual } from "../../src/utility.ts";

describe("deepEqual", () => {
  describe("primitives", () => {
    it("should compare numbers", () => {
      expect(fastDeepEqual(1, 1)).toBe(true);
      expect(fastDeepEqual(1, 2)).toBe(false);
      expect(fastDeepEqual(0, 0)).toBe(true);
      expect(fastDeepEqual(-1, -1)).toBe(true);
    });

    it("should compare strings", () => {
      expect(fastDeepEqual("hello", "hello")).toBe(true);
      expect(fastDeepEqual("hello", "world")).toBe(false);
      expect(fastDeepEqual("", "")).toBe(true);
    });

    it("should compare booleans", () => {
      expect(fastDeepEqual(true, true)).toBe(true);
      expect(fastDeepEqual(false, false)).toBe(true);
      expect(fastDeepEqual(true, false)).toBe(false);
    });

    it("should compare null and undefined", () => {
      expect(fastDeepEqual(null, null)).toBe(true);
      expect(fastDeepEqual(undefined, undefined)).toBe(true);
      expect(fastDeepEqual(null, undefined)).toBe(false);
    });
  });

  describe("objects", () => {
    it("should compare empty objects", () => {
      expect(fastDeepEqual({}, {})).toBe(true);
    });

    it("should compare flat objects", () => {
      expect(fastDeepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(fastDeepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
      expect(fastDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it("should be order independent", () => {
      expect(fastDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
      expect(
        fastDeepEqual({ x: "foo", y: "bar" }, { y: "bar", x: "foo" })
      ).toBe(true);
    });

    it("should compare nested objects", () => {
      expect(
        fastDeepEqual({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 2, d: 3 } })
      ).toBe(true);
      expect(
        fastDeepEqual({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 2, d: 4 } })
      ).toBe(false);
    });

    it("should handle deeply nested objects", () => {
      const obj1 = { a: { b: { c: { d: { e: 1 } } } } };
      const obj2 = { a: { b: { c: { d: { e: 1 } } } } };
      const obj3 = { a: { b: { c: { d: { e: 2 } } } } };

      expect(fastDeepEqual(obj1, obj2)).toBe(true);
      expect(fastDeepEqual(obj1, obj3)).toBe(false);
    });
  });

  describe("arrays", () => {
    it("should compare empty arrays", () => {
      expect(fastDeepEqual([], [])).toBe(true);
    });

    it("should compare flat arrays", () => {
      expect(fastDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(fastDeepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
      expect(fastDeepEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it("should be order dependent for arrays", () => {
      expect(fastDeepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    });

    it("should compare nested arrays", () => {
      expect(fastDeepEqual([1, [2, 3], 4], [1, [2, 3], 4])).toBe(true);
      expect(fastDeepEqual([1, [2, 3], 4], [1, [2, 4], 4])).toBe(false);
    });

    it("should compare arrays of objects", () => {
      expect(fastDeepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }])).toBe(
        true
      );
      expect(fastDeepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 3 }])).toBe(
        false
      );
    });
  });

  describe("mixed types", () => {
    it("should compare objects with arrays", () => {
      expect(
        fastDeepEqual({ a: [1, 2, 3], b: "test" }, { a: [1, 2, 3], b: "test" })
      ).toBe(true);
      expect(
        fastDeepEqual({ a: [1, 2, 3], b: "test" }, { a: [1, 2, 4], b: "test" })
      ).toBe(false);
    });

    it("should not compare array and object", () => {
      expect(fastDeepEqual([1, 2, 3], { 0: 1, 1: 2, 2: 3 })).toBe(false);
    });

    it("should handle complex nested structures", () => {
      const obj1 = {
        name: "device",
        state: {
          on: true,
          brightness: 75,
          color: { r: 255, g: 128, b: 0 },
        },
        endpoints: [
          { id: 1, exposes: ["light", "brightness"] },
          { id: 2, exposes: ["switch"] },
        ],
      };

      const obj2 = {
        name: "device",
        state: {
          on: true,
          brightness: 75,
          color: { r: 255, g: 128, b: 0 },
        },
        endpoints: [
          { id: 1, exposes: ["light", "brightness"] },
          { id: 2, exposes: ["switch"] },
        ],
      };

      const obj3 = {
        name: "device",
        state: {
          on: true,
          brightness: 80, // different
          color: { r: 255, g: 128, b: 0 },
        },
        endpoints: [
          { id: 1, exposes: ["light", "brightness"] },
          { id: 2, exposes: ["switch"] },
        ],
      };

      expect(fastDeepEqual(obj1, obj2)).toBe(true);
      expect(fastDeepEqual(obj1, obj3)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle same reference", () => {
      const obj = { a: 1, b: 2 };
      expect(fastDeepEqual(obj, obj)).toBe(true);
    });

    it("should handle empty vs non-empty", () => {
      expect(fastDeepEqual({}, { a: 1 })).toBe(false);
      expect(fastDeepEqual([], [1])).toBe(false);
    });

    it("should handle different types at same level", () => {
      expect(fastDeepEqual({ a: 1 }, { a: "1" })).toBe(false);
      expect(fastDeepEqual({ a: true }, { a: 1 })).toBe(false);
      expect(fastDeepEqual({ a: null }, { a: undefined })).toBe(false);
    });

    it("should handle objects with undefined values", () => {
      expect(fastDeepEqual({ a: undefined }, { a: undefined })).toBe(true);
      expect(fastDeepEqual({ a: undefined }, { a: null })).toBe(false);
      expect(fastDeepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(false);
    });
  });

  describe("real-world use cases", () => {
    it("should compare device states", () => {
      const state1 = {
        status: "on",
        brightness: 75,
        color: { r: 255, g: 128, b: 0 },
        linkQuality: 89,
      };

      const state2 = {
        status: "on",
        brightness: 75,
        color: { r: 255, g: 128, b: 0 },
        linkQuality: 89,
      };

      const state3 = {
        status: "on",
        brightness: 80, // changed
        color: { r: 255, g: 128, b: 0 },
        linkQuality: 89,
      };

      expect(fastDeepEqual(state1, state2)).toBe(true);
      expect(fastDeepEqual(state1, state3)).toBe(false);
    });

    it("should compare Google device states", () => {
      const googleState1 = {
        online: true,
        on: true,
        brightness: 75,
        color: { spectrumRGB: 16744448 },
      };

      const googleState2 = {
        online: true,
        on: true,
        brightness: 75,
        color: { spectrumRGB: 16744448 },
      };

      const googleState3 = {
        online: true,
        on: false, // changed
        brightness: 75,
        color: { spectrumRGB: 16744448 },
      };

      expect(fastDeepEqual(googleState1, googleState2)).toBe(true);
      expect(fastDeepEqual(googleState1, googleState3)).toBe(false);
    });
  });
});
