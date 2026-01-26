/**
 * Custom Data Shape Assertion Helpers
 *
 * Strict validators for Homed protocol data structures.
 * Assertions marked as "relaxable" can be loosened later without breaking tests.
 *
 * Focuses on:
 * - Required vs optional fields
 * - Type validation (number, string, array, object)
 * - Value ranges and formats (e.g., color 0-255, online/offline status)
 * - Nested property validation
 */

import { expect } from "vitest";
import type {
  CommandMessage,
  HomedExposeMessage,
  HomedStateMessage,
  HomedStatusMessage,
} from "./testClient.ts";

/**
 * Validate device expose message structure
 * Topic: fd/{uniqueId}/{deviceId}
 *
 * @param expose - Raw message object to validate
 * @throws AssertionError if structure is invalid
 */
export function assertValidExposeMessage(
  expose: unknown
): asserts expose is HomedExposeMessage {
  expect(expose).toBeDefined();
  expect(typeof expose).toBe("object");
  expect(expose).not.toBeNull();

  const msg = expose as Record<string, unknown>;

  // Required fields (strict)
  expect(msg).toHaveProperty("id");
  expect(typeof msg.id).toBe("number");
  expect(msg.id).toBeGreaterThanOrEqual(0);
  // Relaxable: could extend to support 64-bit device IDs

  expect(msg).toHaveProperty("name");
  expect(typeof msg.name).toBe("string");
  expect((msg.name as string).length).toBeGreaterThan(0);
  // Relaxable: could add max length constraint

  expect(msg).toHaveProperty("exposes");
  expect(Array.isArray(msg.exposes)).toBe(true);
  expect((msg.exposes as unknown[]).length).toBeGreaterThan(0);
  // Each expose must be a non-empty string (strict)
  (msg.exposes as unknown[]).forEach((expose: unknown) => {
    expect(typeof expose).toBe("string");
    expect((expose as string).length).toBeGreaterThan(0);
  });

  // Optional fields (relaxable: structure can vary)
  if (Object.prototype.hasOwnProperty.call(msg, "options")) {
    expect(typeof msg.options).toBe("object");
    expect(msg.options).not.toBeNull();
    // Don't validate options content—varies by device type
  }
}

/**
 * Validate device state message structure
 * Topic: bd/{uniqueId}/{deviceId}/status
 *
 * Real examples:
 * - {"on": 1, "brightness": 100, "color": {"r": 255, "g": 200, "b": 100}}
 * - {"position": 50, "moving": false}
 * - {"setpoint": 22.5, "current": 21.0}
 *
 * @param state - Raw message object to validate
 * @throws AssertionError if structure is invalid
 */
export function assertValidStateMessage(
  state: unknown,
  options?: {
    allowEmpty?: boolean; // Relaxable: allow {} state messages
  }
): asserts state is HomedStateMessage {
  expect(state).toBeDefined();
  expect(typeof state).toBe("object");
  expect(state).not.toBeNull();

  const msg = state as Record<string, unknown>;

  // At least one property (strict; relaxable if device types require empty states)
  if (!options?.allowEmpty) {
    expect(Object.keys(msg).length).toBeGreaterThan(0);
  }

  // Validate common state properties if present
  if (Object.prototype.hasOwnProperty.call(msg, "on")) {
    expect(typeof msg.on).toBe("number");
    expect([0, 1]).toContain(msg.on); // Binary on/off
  }

  if (Object.prototype.hasOwnProperty.call(msg, "brightness")) {
    expect(typeof msg.brightness).toBe("number");
    expect(msg.brightness).toBeGreaterThanOrEqual(0);
    expect(msg.brightness).toBeLessThanOrEqual(100); // Percentage (relaxable: could be 0-255)
  }

  if (Object.prototype.hasOwnProperty.call(msg, "color")) {
    assertValidColorValue(msg.color);
  }

  if (Object.prototype.hasOwnProperty.call(msg, "position")) {
    expect(typeof msg.position).toBe("number");
    expect(msg.position).toBeGreaterThanOrEqual(0);
    expect(msg.position).toBeLessThanOrEqual(100); // Percentage
  }

  if (Object.prototype.hasOwnProperty.call(msg, "setpoint")) {
    expect(typeof msg.setpoint).toBe("number");
  }

  if (Object.prototype.hasOwnProperty.call(msg, "current")) {
    expect(typeof msg.current).toBe("number");
  }

  if (Object.prototype.hasOwnProperty.call(msg, "moving")) {
    expect(typeof msg.moving).toBe("number");
    expect([0, 1]).toContain(msg.moving);
  }

  if (Object.prototype.hasOwnProperty.call(msg, "status")) {
    expect(typeof msg.status).toBe("string");
    // Relaxable: could add more specific status values
  }
}

/**
 * Validate device status message
 * Topic: bd/{uniqueId}/{deviceId}
 *
 * Indicates online/offline and optional timestamp
 *
 * @param status - Raw message object to validate
 * @throws AssertionError if structure is invalid
 */
export function assertValidStatusMessage(
  status: unknown
): asserts status is HomedStatusMessage {
  expect(status).toBeDefined();
  expect(typeof status).toBe("object");
  expect(status).not.toBeNull();

  const msg = status as Record<string, unknown>;

  // Required field (strict)
  expect(msg).toHaveProperty("status");
  expect(typeof msg.status).toBe("string");
  expect(["online", "offline"]).toContain(msg.status);

  // Optional timestamp
  if (Object.prototype.hasOwnProperty.call(msg, "timestamp")) {
    expect(typeof msg.timestamp).toBe("number");
    expect(msg.timestamp).toBeGreaterThan(0);
    // Relaxable: could validate timestamp is recent (within last 1 hour)
  }
}

/**
 * Validate command message from server to device
 * Topic: td/{deviceId}/{command}
 *
 * Real examples:
 * - {"on": 1}
 * - {"brightness": 75}
 * - {"color": {"r": 255, "g": 0, "b": 0}}
 * - {"position": 50}
 * - {"setpoint": 22}
 *
 * @param command - Raw message object to validate
 * @throws AssertionError if structure is invalid
 */
export function assertValidCommandMessage(
  command: unknown
): asserts command is CommandMessage {
  expect(command).toBeDefined();
  expect(typeof command).toBe("object");
  expect(command).not.toBeNull();

  const msg = command as Record<string, unknown>;

  // At least one property (strict)
  expect(Object.keys(msg).length).toBeGreaterThan(0);

  // Validate known command properties
  if (Object.prototype.hasOwnProperty.call(msg, "on")) {
    expect(typeof msg.on).toBe("number");
    expect([0, 1]).toContain(msg.on);
  }

  if (Object.prototype.hasOwnProperty.call(msg, "brightness")) {
    expect(typeof msg.brightness).toBe("number");
    expect(msg.brightness).toBeGreaterThanOrEqual(0);
    expect(msg.brightness).toBeLessThanOrEqual(100);
  }

  if (Object.prototype.hasOwnProperty.call(msg, "color")) {
    assertValidColorValue(msg.color);
  }

  if (Object.prototype.hasOwnProperty.call(msg, "position")) {
    expect(typeof msg.position).toBe("number");
    expect(msg.position).toBeGreaterThanOrEqual(0);
    expect(msg.position).toBeLessThanOrEqual(100);
  }

  if (Object.prototype.hasOwnProperty.call(msg, "setpoint")) {
    expect(typeof msg.setpoint).toBe("number");
  }
}

/**
 * Validate color object in state or command
 * Must have r, g, b components in 0-255 range
 *
 * @param color - Color object to validate
 * @throws AssertionError if invalid
 */
function assertValidColorValue(color: unknown): void {
  expect(typeof color).toBe("object");
  expect(color).not.toBeNull();

  const c = color as Record<string, unknown>;

  // Strict: must have all color components
  expect(c).toHaveProperty("r");
  expect(c).toHaveProperty("g");
  expect(c).toHaveProperty("b");

  // Each must be 0-255 (strict)
  expect(typeof c.r).toBe("number");
  expect(c.r).toBeGreaterThanOrEqual(0);
  expect(c.r).toBeLessThanOrEqual(255);

  expect(typeof c.g).toBe("number");
  expect(c.g).toBeGreaterThanOrEqual(0);
  expect(c.g).toBeLessThanOrEqual(255);

  expect(typeof c.b).toBe("number");
  expect(c.b).toBeGreaterThanOrEqual(0);
  expect(c.b).toBeLessThanOrEqual(255);

  // Optional alpha (relaxable: support alpha transparency)
  if (Object.prototype.hasOwnProperty.call(c, "a")) {
    expect(typeof c.a).toBe("number");
    expect(c.a).toBeGreaterThanOrEqual(0);
    expect(c.a).toBeLessThanOrEqual(255);
  }
}

/**
 * Assert message matches topic pattern
 * Helper for checking if a message was published to expected topic
 *
 * @param topic - Actual topic
 * @param expectedPattern - Expected topic or pattern (e.g., "td/+/switch")
 * @throws AssertionError if topic doesn't match pattern
 */
export function assertMessageTopic(
  topic: string,
  expectedPattern: string
): void {
  if (expectedPattern.includes("+") || expectedPattern.includes("#")) {
    // Pattern matching - convert MQTT wildcards to regex
    const regexPattern = expectedPattern
      .replace(/[.^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
      .replace(/\\\+/g, "[^/]+") // Replace escaped + with single-level match
      .replace(/\\#/g, ".*"); // Replace escaped # with multi-level match

    const regex = new RegExp(`^${regexPattern}$`);
    expect(regex.test(topic)).toBe(true);
  } else {
    // Exact match
    expect(topic).toBe(expectedPattern);
  }
}

/**
 * Wait for a message on a specific topic with timeout
 * Useful for assertions like "device should respond to command within Xms"
 *
 * @param messages - Array of messages to search
 * @param topicPattern - Topic or pattern to match
 * @param options - Timeout and other options
 * @returns Matching message or throws if not found
 */
export function findMessageByTopic(
  messages: Array<{ topic: string; message: unknown }>,
  topicPattern: string
): (typeof messages)[0] {
  const message = messages.find(m => {
    if (topicPattern.includes("+") || topicPattern.includes("#")) {
      // Convert MQTT wildcards to regex
      const regexPattern = topicPattern
        .replace(/[.^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
        .replace(/\\\+/g, "[^/]+") // Replace escaped + with single-level match
        .replace(/\\#/g, ".*"); // Replace escaped # with multi-level match

      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(m.topic);
    }
    return m.topic === topicPattern;
  });

  expect(message, `No message found for topic: ${topicPattern}`).toBeDefined();
  return message!;
}

/**
 * Relaxable assertions helper
 * Marks assertion as "can be loosened later" via inline comment
 *
 * Usage:
 *   // Relaxable: color model validation (could support HSL, HSV)
 *   assertRelaxable(() => {
 *     expect(expose.options?.colorModel).toBe("rgb");
 *   });
 */
export function assertRelaxable(assertion: () => void): void {
  assertion();
}
