import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClientToken,
  User,
  UserRepository,
} from "../../src/db/repository.ts";
import type { DeviceId, DeviceRepository } from "../../src/device.ts";
import type { SmartHomeRequest } from "../../src/google/schema.ts";
import type {
  ExecuteResponsePayload,
  SmartHomeResponseBase,
} from "../../src/google/types.ts";
import type { DeviceState } from "../../src/homed/types.ts";
import {
  createClientId,
  createDeviceId,
  createMockDevice,
  createUserId,
} from "../factories.ts";

// Declare spies at module scope that will be reassigned in beforeEach
let reportStateAndNotificationSpy: ReturnType<typeof vi.fn>;
let requestSyncSpy: ReturnType<typeof vi.fn>;

// Mock googleapis before importing FulfillmentController
vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn(),
    },
    homegraph: vi.fn(() => ({
      devices: {
        get requestSync() {
          return requestSyncSpy;
        },
        get reportStateAndNotification() {
          return reportStateAndNotificationSpy;
        },
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
    // Create fresh spies for each test with proper mock implementations
    reportStateAndNotificationSpy = vi.fn().mockResolvedValue(undefined);
    requestSyncSpy = vi.fn().mockResolvedValue(undefined);

    // Stub environment variable to ensure GoogleAuth initialization in constructor
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/path/to/credentials.json");
    // Clear call history for mocks (doesn't clear across module scope)
    vi.clearAllMocks();

    // Create mock repositories
    mockUserRepository = {
      findByClientToken: vi.fn(),
      findById: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      isUserLinked: vi.fn().mockResolvedValue(true),
    } as unknown as UserRepository;

    mockDeviceRepository = {
      getDevices: vi.fn(),
      getClientDevice: vi.fn(),
      getDeviceState: vi.fn(),
      syncClientDevices: vi.fn(),
      setDeviceStatus: vi.fn(),
      setDeviceState: vi.fn(),
      removeDevices: vi.fn(),
      executeCommand: vi.fn(() => true),
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
    expect(deviceIds.some(id => id.includes("#1"))).toBe(true);
    expect(deviceIds.some(id => id.includes("#2"))).toBe(true);
    expect(deviceIds.some(id => id.includes("#3"))).toBe(true);
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

  it("should trigger requestSync when reportState returns 404 (entity not found)", async () => {
    const device = createMockDevice();
    const prevState: DeviceState = { status: "off" };
    const newState: DeviceState = { status: "on" };

    const notFoundError = Object.assign(
      new Error("Requested entity was not found."),
      { status: 404 }
    );
    reportStateAndNotificationSpy.mockRejectedValueOnce(notFoundError);

    // User is still linked - isUserLinked called twice:
    // once in reportState, once in requestSync
    (
      mockUserRepository.isUserLinked as ReturnType<typeof vi.fn>
    ).mockResolvedValue(true);

    const eventHandler = vi
      .mocked(mockDeviceRepository.on)
      .mock.calls.find(call => call[0] === "deviceStateChanged")?.[1];

    await eventHandler?.({
      userId,
      clientId,
      deviceId,
      device,
      prevState,
      newState,
    });

    expect(mockUserRepository.isUserLinked).toHaveBeenCalledWith(userId);
    expect(requestSyncSpy).toHaveBeenCalledTimes(1);
    expect(requestSyncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { agentUserId: userId, async: true },
      })
    );
  });

  it("should not trigger requestSync for 404 when user has been deleted", async () => {
    const device = createMockDevice();
    const prevState: DeviceState = { status: "off" };
    const newState: DeviceState = { status: "on" };

    const notFoundError = Object.assign(
      new Error("Requested entity was not found."),
      { status: 404 }
    );
    reportStateAndNotificationSpy.mockRejectedValueOnce(notFoundError);

    // Mock user is not linked (has been unlinked)
    (
      mockUserRepository.isUserLinked as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(false);

    const eventHandler = vi
      .mocked(mockDeviceRepository.on)
      .mock.calls.find(call => call[0] === "deviceStateChanged")?.[1];

    await eventHandler?.({
      userId,
      clientId,
      deviceId,
      device,
      prevState,
      newState,
    });

    expect(mockUserRepository.isUserLinked).toHaveBeenCalledWith(userId);
    expect(requestSyncSpy).not.toHaveBeenCalled();
  });

  it("should not trigger requestSync for non-404 reportState errors", async () => {
    const device = createMockDevice();
    const prevState: DeviceState = { status: "off" };
    const newState: DeviceState = { status: "on" };

    const serverError = Object.assign(new Error("Internal Server Error"), {
      status: 500,
    });
    reportStateAndNotificationSpy.mockRejectedValueOnce(serverError);

    const eventHandler = vi
      .mocked(mockDeviceRepository.on)
      .mock.calls.find(call => call[0] === "deviceStateChanged")?.[1];

    await eventHandler?.({
      userId,
      clientId,
      deviceId,
      device,
      prevState,
      newState,
    });

    expect(requestSyncSpy).not.toHaveBeenCalled();
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

describe("FulfillmentController - EXECUTE Intent", () => {
  let fulfillmentController: InstanceType<typeof FulfillmentController>;
  let mockUserRepository: UserRepository;
  let mockDeviceRepository: DeviceRepository;

  const userId = createUserId("user1");
  const user: User = {
    id: userId,
    clientToken: "token" as ClientToken,
    username: "testuser",
    linked: true,
    createdAt: new Date(),
  };
  const clientId = createClientId("client1");
  const deviceId = createDeviceId("device1");

  beforeEach(() => {
    // Create fresh spies for each test
    reportStateAndNotificationSpy = vi.fn().mockResolvedValue(undefined);
    requestSyncSpy = vi.fn().mockResolvedValue(undefined);

    // Stub environment variable
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/path/to/credentials.json");
    vi.clearAllMocks();

    // Create mock repositories
    mockUserRepository = {
      findByClientToken: vi.fn(),
      findById: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      isUserLinked: vi.fn().mockResolvedValue(true),
    } as unknown as UserRepository;

    mockDeviceRepository = {
      getDevices: vi.fn(() => []),
      getClientDevice: vi.fn(),
      getDeviceState: vi.fn(),
      syncClientDevices: vi.fn(),
      setDeviceStatus: vi.fn(),
      setDeviceState: vi.fn(),
      removeDevices: vi.fn(),
      executeCommand: vi.fn(() => true),
      on: vi.fn(() => mockDeviceRepository),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as DeviceRepository;

    fulfillmentController = new FulfillmentController(
      mockUserRepository,
      mockDeviceRepository
    );
  });

  it("should execute OnOff command on single device", async () => {
    const device = createMockDevice(deviceId, "Test Switch");
    device.endpoints = [{ id: 0, exposes: ["switch"], options: {} }];

    vi.mocked(mockDeviceRepository.getDevices).mockReturnValue([
      { device, clientId },
    ]);

    const request = {
      requestId: "req-123",
      inputs: [
        {
          intent: "action.devices.EXECUTE" as const,
          payload: {
            commands: [
              {
                devices: [{ id: `${clientId}/${deviceId}` }],
                execution: [
                  {
                    command: "action.devices.commands.OnOff",
                    params: { on: true },
                  },
                ],
              },
            ],
          },
        },
      ],
    } satisfies SmartHomeRequest;

    const response = (await fulfillmentController.handleFulfillment(
      user,
      request
    )) as SmartHomeResponseBase<ExecuteResponsePayload>;

    // Should execute command via repository
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledWith(
      userId,
      clientId,
      deviceId,
      undefined, // No endpoint ID for single-endpoint device
      { status: "on" }
    );

    // Should return success
    expect(response.payload.commands).toHaveLength(1);
    expect(response.payload.commands[0].status).toBe("SUCCESS");
    expect(response.payload.commands[0].ids).toContain(
      `${clientId}/${deviceId}`
    );
  });

  it("should execute BrightnessAbsolute command", async () => {
    const device = createMockDevice(deviceId, "Test Light");
    device.endpoints = [
      { id: 0, exposes: ["light", "brightness"], options: {} },
    ];

    vi.mocked(mockDeviceRepository.getDevices).mockReturnValue([
      { device, clientId },
    ]);

    const request = {
      requestId: "req-123",
      inputs: [
        {
          intent: "action.devices.EXECUTE" as const,
          payload: {
            commands: [
              {
                devices: [{ id: `${clientId}/${deviceId}` }],
                execution: [
                  {
                    command: "action.devices.commands.BrightnessAbsolute",
                    params: { brightness: 75 },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    await fulfillmentController.handleFulfillment(user, request);

    // Should execute brightness command (75% = level 191)
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledWith(
      userId,
      clientId,
      deviceId,
      undefined,
      { level: 191 }
    );
  });

  it("should execute command on multi-endpoint device with specific endpoint", async () => {
    const device = createMockDevice(deviceId, "Multi Switch");
    device.endpoints = [
      { id: 1, exposes: ["switch"], options: {} },
      { id: 2, exposes: ["switch"], options: {} },
    ];

    vi.mocked(mockDeviceRepository.getDevices).mockReturnValue([
      { device, clientId },
    ]);

    const request = {
      requestId: "req-123",
      inputs: [
        {
          intent: "action.devices.EXECUTE" as const,
          payload: {
            commands: [
              {
                devices: [{ id: `${clientId}/${deviceId}#1` }],
                execution: [
                  {
                    command: "action.devices.commands.OnOff",
                    params: { on: true },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    await fulfillmentController.handleFulfillment(user, request);

    // Should execute command on endpoint 1 only
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledWith(
      userId,
      clientId,
      deviceId,
      1, // Endpoint ID
      { status: "on" }
    );
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledTimes(1);
  });

  it("should execute multiple commands on same device", async () => {
    const device = createMockDevice(deviceId, "RGB Light");
    device.endpoints = [
      { id: 0, exposes: ["light", "brightness", "color_light"], options: {} },
    ];

    vi.mocked(mockDeviceRepository.getDevices).mockReturnValue([
      { device, clientId },
    ]);

    const request = {
      requestId: "req-123",
      inputs: [
        {
          intent: "action.devices.EXECUTE" as const,
          payload: {
            commands: [
              {
                devices: [{ id: `${clientId}/${deviceId}` }],
                execution: [
                  {
                    command: "action.devices.commands.OnOff",
                    params: { on: true },
                  },
                  {
                    command: "action.devices.commands.BrightnessAbsolute",
                    params: { brightness: 50 },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    await fulfillmentController.handleFulfillment(user, request);

    // Should execute both commands
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledTimes(2);
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledWith(
      userId,
      clientId,
      deviceId,
      undefined,
      { status: "on" }
    );
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledWith(
      userId,
      clientId,
      deviceId,
      undefined,
      { level: 128 }
    );
  });

  it("should execute commands on multiple devices", async () => {
    const device1 = createMockDevice(deviceId, "Switch 1");
    device1.endpoints = [{ id: 0, exposes: ["switch"], options: {} }];

    const device2Id = createDeviceId("device2");
    const device2 = createMockDevice(device2Id, "Switch 2");
    device2.endpoints = [{ id: 0, exposes: ["switch"], options: {} }];

    vi.mocked(mockDeviceRepository.getDevices).mockReturnValue([
      { device: device1, clientId },
      { device: device2, clientId },
    ]);

    const request = {
      requestId: "req-123",
      inputs: [
        {
          intent: "action.devices.EXECUTE" as const,
          payload: {
            commands: [
              {
                devices: [
                  { id: `${clientId}/${deviceId}` },
                  { id: `${clientId}/${device2Id}` },
                ],
                execution: [
                  {
                    command: "action.devices.commands.OnOff",
                    params: { on: true },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    await fulfillmentController.handleFulfillment(user, request);

    // Should execute command on both devices
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledTimes(2);
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledWith(
      userId,
      clientId,
      deviceId,
      undefined,
      { status: "on" }
    );
    expect(mockDeviceRepository.executeCommand).toHaveBeenCalledWith(
      userId,
      clientId,
      device2Id,
      undefined,
      { status: "on" }
    );
  });

  it("should return OFFLINE status when device not found", async () => {
    vi.mocked(mockDeviceRepository.getDevices).mockReturnValue([]);

    const request = {
      requestId: "req-123",
      inputs: [
        {
          intent: "action.devices.EXECUTE" as const,
          payload: {
            commands: [
              {
                devices: [{ id: `${clientId}/${deviceId}` }],
                execution: [
                  {
                    command: "action.devices.commands.OnOff",
                    params: { on: true },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const response = (await fulfillmentController.handleFulfillment(
      user,
      request
    )) as SmartHomeResponseBase<ExecuteResponsePayload>;

    // Should not execute command
    expect(mockDeviceRepository.executeCommand).not.toHaveBeenCalled();

    // Should return no commands (no matching devices)
    expect(response.payload.commands).toHaveLength(0);
  });

  it("should return OFFLINE status when executeCommand returns false", async () => {
    const device = createMockDevice(deviceId, "Offline Switch");
    device.endpoints = [{ id: 0, exposes: ["switch"], options: {} }];

    vi.mocked(mockDeviceRepository.getDevices).mockReturnValue([
      { device, clientId },
    ]);
    vi.mocked(mockDeviceRepository.executeCommand).mockReturnValue(false);

    const request = {
      requestId: "req-123",
      inputs: [
        {
          intent: "action.devices.EXECUTE" as const,
          payload: {
            commands: [
              {
                devices: [{ id: `${clientId}/${deviceId}` }],
                execution: [
                  {
                    command: "action.devices.commands.OnOff",
                    params: { on: true },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const response = (await fulfillmentController.handleFulfillment(
      user,
      request
    )) as SmartHomeResponseBase<ExecuteResponsePayload>;

    // Should return OFFLINE status
    expect(response.payload.commands).toHaveLength(1);
    expect(response.payload.commands[0].status).toBe("OFFLINE");
    expect(response.payload.commands[0].errorCode).toBe("deviceOffline");
  });
});
