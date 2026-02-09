import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserId, UserRepository } from "../../src/db/repository.ts";
import type {
  DeviceId,
  DeviceRepository,
  HomedDevice,
} from "../../src/device.ts";
import { FulfillmentController } from "../../src/google/fulfillment.ts";
import type { ClientId } from "../../src/homed/client.ts";
import type { DeviceState } from "../../src/homed/types.ts";

const createUserId = (id: string): UserId => id as UserId;
const createClientId = (id: string): ClientId => id as ClientId;
const createDeviceId = (id: string): DeviceId => id as DeviceId;

const createMockDevice = (key: string, name?: string): HomedDevice => ({
  key,
  topic: `test/${key}`,
  name: name ?? `Device ${key}`,
  available: true,
  endpoints: [
    {
      id: 0,
      exposes: ["switch"],
      options: {},
    },
  ],
});

describe("FulfillmentController - State Change Listener", () => {
  let _fulfillmentController: FulfillmentController;
  let mockUserRepository: UserRepository;
  let mockDeviceRepository: DeviceRepository;
  let reportStateChangeSpy: ReturnType<typeof vi.fn>;

  const userId = createUserId("user1");
  const clientId = createClientId("client1");
  const deviceId = createDeviceId("device1");

  beforeEach(() => {
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

    // Create mock HomeGraphClient
    reportStateChangeSpy = vi.fn().mockResolvedValue(undefined);

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
    const device = createMockDevice("device1", "Test Device");
    const newState: DeviceState = { status: "on", data: { brightness: 75 } };

    vi.mocked(mockDeviceRepository.getDevice).mockReturnValue(device);

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
      newState,
    });

    // Should report to Google
    expect(reportStateChangeSpy).toHaveBeenCalledTimes(1);
    expect(reportStateChangeSpy).toHaveBeenCalledWith(userId, [
      {
        googleDeviceId: expect.stringContaining("device1"),
        state: expect.objectContaining({ online: true, on: true }),
      },
    ]);
  });

  it("should not report devices without traits", async () => {
    const device = createMockDevice("device1", "Test Device");
    device.endpoints = [{ id: 0, exposes: [], options: {} }]; // No exposes = no traits

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
      newState,
    });

    // Should not report to Google
    expect(reportStateChangeSpy).not.toHaveBeenCalled();
  });

  it("should handle multi-endpoint devices correctly", async () => {
    const device = createMockDevice("device1", "Multi Switch");
    device.endpoints = [
      { id: 1, exposes: ["switch"], options: {} },
      { id: 2, exposes: ["switch"], options: {} },
      { id: 3, exposes: ["switch"], options: {} },
    ];

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
      newState,
    });

    // Should report all 3 endpoints
    expect(reportStateChangeSpy).toHaveBeenCalledTimes(1);
    expect(reportStateChangeSpy).toHaveBeenCalledWith(
      userId,
      expect.arrayContaining([
        expect.objectContaining({
          googleDeviceId: expect.stringContaining(":1"),
        }),
        expect.objectContaining({
          googleDeviceId: expect.stringContaining(":2"),
        }),
        expect.objectContaining({
          googleDeviceId: expect.stringContaining(":3"),
        }),
      ])
    );
  });

  it("should handle errors gracefully and not throw", async () => {
    const device = createMockDevice("device1");
    const newState: DeviceState = { status: "on" };

    reportStateChangeSpy.mockRejectedValueOnce(new Error("API Error"));

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
        newState,
      })
    ).resolves.not.toThrow();
  });

  it("should batch multiple device reports in single API call", async () => {
    const device = createMockDevice("device1");
    device.endpoints = [
      { id: 0, exposes: ["switch", "brightness"], options: {} },
    ];

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
      newState,
    });

    // Should make only one API call
    expect(reportStateChangeSpy).toHaveBeenCalledTimes(1);
  });
});
