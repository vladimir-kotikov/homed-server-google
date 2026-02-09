import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRepository } from "../../src/db/repository.ts";
import type { DeviceId, DeviceRepository } from "../../src/device.ts";
import type { DeviceState } from "../../src/homed/types.ts";
import {
  createClientId,
  createDeviceId,
  createMockDevice,
  createUserId,
} from "../factories.ts";

// Create the spy outside and reference it in the mock
const reportStateAndNotificationSpy = vi.fn().mockResolvedValue(undefined);
const requestSyncSpy = vi.fn().mockResolvedValue(undefined);

// Mock googleapis before importing FulfillmentController
vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn(),
    },
    homegraph: vi.fn(() => ({
      devices: {
        requestSync: requestSyncSpy,
        reportStateAndNotification: reportStateAndNotificationSpy,
      },
    })),
  },
}));

// Import after mocking
const { FulfillmentController } =
  await import("../../src/google/fulfillment.ts");

describe("FulfillmentController - State Change Listener", () => {
  let _fulfillmentController: InstanceType<typeof FulfillmentController>;
  let mockUserRepository: UserRepository;
  let mockDeviceRepository: DeviceRepository;

  const userId = createUserId("user1");
  const clientId = createClientId("client1");
  const deviceId = createDeviceId("device1");

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock repositories
    mockUserRepository = {
      findByClientToken: vi.fn(),
      findById: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
    } as unknown as UserRepository;

    mockDeviceRepository = {
      getDevices: vi.fn(),
      getClientDevice: vi.fn(),
      getDeviceState: vi.fn(),
      syncClientDevices: vi.fn(),
      setDeviceStatus: vi.fn(),
      setDeviceState: vi.fn(),
      removeDevices: vi.fn(),
      on: vi.fn(() => mockDeviceRepository),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as DeviceRepository;

    _fulfillmentController = new FulfillmentController(
      mockUserRepository,
      mockDeviceRepository
    );
  });

  it("should register deviceStateChangedd event listener on construction", () => {
    expect(mockDeviceRepository.on).toHaveBeenCalledWith(
      "deviceStateChanged",
      expect.any(Function)
    );
  });

  it("should report state changes to Google Home Graph when event is received", async () => {
    const device = createMockDevice(
      "/zigbee/device1" as DeviceId,
      "Test Device"
    );
    const prevState: DeviceState = { status: "off" };
    const newState: DeviceState = { status: "on", data: { brightness: 75 } };

    // Get the registered event handler
    const eventHandler = vi
      .mocked(mockDeviceRepository.on)
      .mock.calls.find(call => call[0] === "deviceStateChanged")?.[1];

    expect(eventHandler).toBeDefined();

    // Trigger the event
    await eventHandler?.({
      userId,
      clientId,
      deviceId,
      device,
      prevState,
      newState,
    });

    // Should report to Google
    expect(reportStateAndNotificationSpy).toHaveBeenCalledTimes(1);
    const callArg = reportStateAndNotificationSpy.mock.calls[0][0];

    expect(callArg.requestBody.agentUserId).toBe(userId);
    expect(callArg.requestBody.requestId).toBeDefined();

    const states = callArg.requestBody.payload.devices.states;
    const deviceIds = Object.keys(states);
    expect(deviceIds).toHaveLength(1);
    expect(deviceIds[0]).toContain("device1");
    expect(states[deviceIds[0]]).toEqual({
      online: true,
      on: true,
    });
  });

  it("should not report devices without traits", async () => {
    const device = createMockDevice();
    device.endpoints = [{ id: 0, exposes: [], options: {} }]; // No exposes = no traits

    const prevState: DeviceState = { status: "off" };
    const newState: DeviceState = { status: "on" };

    // Get the registered event handler
    const eventHandler = vi
      .mocked(mockDeviceRepository.on)
      .mock.calls.find(call => call[0] === "deviceStateChanged")?.[1];

    // Trigger the event
    await eventHandler?.({
      userId,
      clientId,
      deviceId,
      device,
      prevState,
      newState,
    });

    // Should not report to Google
    expect(reportStateAndNotificationSpy).not.toHaveBeenCalled();
  });

  it("should handle multi-endpoint devices correctly", async () => {
    const device = createMockDevice();
    device.endpoints = [
      { id: 1, exposes: ["switch"], options: {} },
      { id: 2, exposes: ["switch"], options: {} },
      { id: 3, exposes: ["switch"], options: {} },
    ];

    const prevState: DeviceState = { status: "off" };
    const newState: DeviceState = { status: "on" };

    // Get the registered event handler
    const eventHandler = vi
      .mocked(mockDeviceRepository.on)
      .mock.calls.find(call => call[0] === "deviceStateChanged")?.[1];

    // Trigger the event
    await eventHandler?.({
      userId,
      clientId,
      deviceId,
      device,
      prevState,
      newState,
    });

    // Should report all 3 endpoints
    expect(reportStateAndNotificationSpy).toHaveBeenCalledTimes(1);
    const callArg = reportStateAndNotificationSpy.mock.calls[0][0];
    const states = callArg.requestBody.payload.devices.states;
    const deviceIds = Object.keys(states);

    expect(deviceIds).toHaveLength(3);
    expect(deviceIds.some(id => id.includes(":1"))).toBe(true);
    expect(deviceIds.some(id => id.includes(":2"))).toBe(true);
    expect(deviceIds.some(id => id.includes(":3"))).toBe(true);
  });

  it("should handle errors gracefully and not throw", async () => {
    const device = createMockDevice();
    const prevState: DeviceState = { status: "off" };
    const newState: DeviceState = { status: "on" };

    reportStateAndNotificationSpy.mockRejectedValueOnce(new Error("API Error"));

    // Get the registered event handler
    const eventHandler = vi
      .mocked(mockDeviceRepository.on)
      .mock.calls.find(call => call[0] === "deviceStateChanged")?.[1];

    // Should not throw
    await expect(
      eventHandler?.({
        userId,
        clientId,
        deviceId,
        device,
        prevState,
        newState,
      })
    ).resolves.not.toThrow();
  });

  it("should batch multiple device reports in single API call", async () => {
    const device = createMockDevice();
    device.endpoints = [
      { id: 0, exposes: ["switch", "brightness"], options: {} },
    ];

    const prevState: DeviceState = { status: "off" };
    const newState: DeviceState = {
      status: "on",
      data: { brightness: 50, power: 100 },
    };

    // Get the registered event handler
    const eventHandler = vi
      .mocked(mockDeviceRepository.on)
      .mock.calls.find(call => call[0] === "deviceStateChanged")?.[1];

    // Trigger the event
    await eventHandler?.({
      userId,
      clientId,
      deviceId,
      device,
      prevState,
      newState,
    });

    // Should make only one API call
    expect(reportStateAndNotificationSpy).toHaveBeenCalledTimes(1);
  });
});
