import * as Sentry from "@sentry/node";
import debugModule, { type Debugger } from "debug";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogExtra } from "../../../src/logger.ts";
import { createLogger, Logger } from "../../../src/logger.ts";

// Mock Sentry
vi.mock("@sentry/node", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  getCurrentScope: vi.fn(() => ({
    getScopeData: vi.fn(() => ({
      tags: {},
      contexts: {},
      user: {},
      extra: {},
    })),
  })),
  withScope: vi.fn((callback: (scope: any) => void) => {
    const mockScope = {
      setTag: vi.fn(),
      setContext: vi.fn(),
      setExtras: vi.fn(),
      setUser: vi.fn(),
      setFingerprint: vi.fn(),
    };
    callback(mockScope);
  }),
}));

// Mock the debug module
vi.mock("debug", () => {
  const createMockDebugger = (): Debugger => {
    const fn = vi.fn() as unknown as Debugger;
    fn.color = "";
    fn.enabled = false;
    fn.namespace = "";
    fn.diff = 0;
    fn.log = vi.fn();
    fn.extend = vi.fn();
    fn.destroy = vi.fn();
    return fn;
  };

  const mockDebug = vi.fn(createMockDebugger) as unknown as typeof debugModule;
  (mockDebug as any).enable = vi.fn();
  (mockDebug as any).disable = vi.fn();
  (mockDebug as any).enabled = vi.fn(() => false);
  return { default: mockDebug };
});

describe("Logger", () => {
  let mockDebugFn: Debugger;
  let mockInfoFn: Debugger;
  let mockWarnFn: Debugger;
  let mockErrorFn: Debugger;
  let logger: Logger;

  beforeEach(() => {
    // Create mock debug functions
    mockDebugFn = vi.fn() as any;
    mockInfoFn = vi.fn() as any;
    mockWarnFn = vi.fn() as any;
    mockErrorFn = vi.fn() as any;

    // Reset all Sentry mocks
    vi.clearAllMocks();

    // Mock getCurrentScope to return empty scope by default
    vi.mocked(Sentry.getCurrentScope).mockReturnValue({
      getScopeData: () => ({
        tags: {},
        contexts: {},
        user: {},
        extra: {},
      }),
    } as any);

    // Create logger instance
    logger = new Logger("test-component", {
      debug: mockDebugFn,
      info: mockInfoFn,
      warn: mockWarnFn,
      error: mockErrorFn,
    });
  });

  describe("debug", () => {
    it("should output to debug instance without meta", () => {
      logger.debug("test message");

      expect(mockDebugFn).toHaveBeenCalledWith("%s", "test message");
    });

    it("should output to debug instance with meta", () => {
      const meta: LogExtra = { foo: "bar" };
      logger.debug("test message", meta);

      expect(mockDebugFn).toHaveBeenCalledWith("%s %O", "test message", meta);
    });

    it("should add breadcrumb to Sentry", () => {
      logger.debug("test message");

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        level: "debug",
        message: "test message",
      });
    });

    it("should add breadcrumb with metadata to Sentry", () => {
      const meta: LogExtra = { userId: "123" };
      logger.debug("test message", meta);

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        level: "debug",
        message: "test message",
        data: meta,
      });
    });
  });

  describe("info", () => {
    it("should output to info debug instance without meta", () => {
      logger.info("test info");

      expect(mockInfoFn).toHaveBeenCalledWith("%s", "test info");
    });

    it("should output to info debug instance with meta", () => {
      const meta: LogExtra = { status: "ok" };
      logger.info("test info", meta);

      expect(mockInfoFn).toHaveBeenCalledWith("%s %O", "test info", meta);
    });

    it("should add breadcrumb to Sentry", () => {
      logger.info("test info");

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        level: "info",
        message: "test info",
      });
    });
  });

  describe("warn", () => {
    it("should output to warn debug instance", () => {
      logger.warn("test warning");

      expect(mockWarnFn).toHaveBeenCalledWith("%s", "test warning");
    });

    it("should add breadcrumb to Sentry", () => {
      logger.warn("test warning");

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        level: "warning",
        message: "test warning",
      });
    });

    it("should capture message to Sentry", () => {
      logger.warn("test warning");

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "test warning",
        "warning"
      );
    });

    it("should use withScope to prevent metadata leakage", () => {
      logger.warn("test warning", { foo: "bar" });

      expect(Sentry.withScope).toHaveBeenCalled();
    });
  });

  describe("error", () => {
    it("should output to error debug instance without error object", () => {
      logger.error("test error");

      expect(mockErrorFn).toHaveBeenCalledWith("%s", "test error");
    });

    it("should output to error debug instance with error object", () => {
      const error = new Error("test");
      logger.error("test error", error);

      expect(mockErrorFn).toHaveBeenCalledWith("%s %O", "test error", error);
    });

    it("should add breadcrumb to Sentry", () => {
      logger.error("test error");

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        level: "error",
        message: "test error",
      });
    });

    it("should capture exception when error object provided", () => {
      const error = new Error("test");
      logger.error("test error", error);

      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });

    it("should capture message when no error object provided", () => {
      logger.error("test error");

      expect(Sentry.captureMessage).toHaveBeenCalledWith("test error", "error");
    });

    it("should use withScope to prevent metadata leakage", () => {
      logger.error("test error", undefined, { foo: "bar" });

      expect(Sentry.withScope).toHaveBeenCalled();
    });
  });

  describe("metadata mapping to Sentry scope", () => {
    it("should map other fields to extras", () => {
      const mockScope = {
        setTag: vi.fn(),
        setContext: vi.fn(),
        setExtras: vi.fn(),
        setUser: vi.fn(),
        setFingerprint: vi.fn(),
      };

      vi.mocked(Sentry.withScope).mockImplementation((callback: any) => {
        callback(mockScope);
      });

      const meta: LogExtra = {
        requestId: "abc123",
        duration: 150,
        tags: { env: "test" },
      };

      logger.warn("test", meta);

      expect(mockScope.setExtras).toHaveBeenCalledWith({
        requestId: "abc123",
        duration: 150,
        tags: { env: "test" },
      });
    });

    it("should add component as a tag automatically", () => {
      const mockScope = {
        setTag: vi.fn(),
        setContext: vi.fn(),
        setExtras: vi.fn(),
        setUser: vi.fn(),
        setFingerprint: vi.fn(),
      };

      vi.mocked(Sentry.withScope).mockImplementation((callback: any) => {
        callback(mockScope);
      });

      logger.warn("test warning");

      expect(mockScope.setTag).toHaveBeenCalledWith(
        "component",
        "test-component"
      );
    });
  });

  describe("withScope prevents metadata leakage", () => {
    it("should call withScope for warn with metadata", () => {
      logger.warn("test", { foo: "bar" });

      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    });

    it("should call withScope for error with metadata", () => {
      logger.error("test", undefined, { foo: "bar" });

      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    });

    it("should call withScope even without explicit metadata for warn", () => {
      logger.warn("test");

      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    });

    it("should call withScope even without explicit metadata for error", () => {
      logger.error("test");

      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    });
  });

  describe("enrichment from Sentry scope", () => {
    it("should enrich debug output with tags from Sentry scope", () => {
      vi.mocked(Sentry.getCurrentScope).mockReturnValue({
        getScopeData: () => ({
          tags: { userId: "123", sessionId: "abc" },
          contexts: {},
          user: {},
          extra: {},
        }),
      } as any);

      logger.debug("test message", { requestId: "xyz" });

      expect(mockDebugFn).toHaveBeenCalledWith("%s %O", "test message", {
        requestId: "xyz",
        "tag.userId": "123",
        "tag.sessionId": "abc",
      });
    });

    it("should enrich debug output with contexts from Sentry scope", () => {
      vi.mocked(Sentry.getCurrentScope).mockReturnValue({
        getScopeData: () => ({
          tags: {},
          contexts: {
            client: { clientId: "client123", connected: true },
            transaction: { id: "tx456" },
          },
          user: {},
          extra: {},
        }),
      } as any);

      logger.info("test message");

      expect(mockInfoFn).toHaveBeenCalledWith("%s %O", "test message", {
        "client.clientId": "client123",
        "client.connected": true,
      });
    });

    it("should filter out internal Sentry contexts", () => {
      vi.mocked(Sentry.getCurrentScope).mockReturnValue({
        getScopeData: () => ({
          tags: {},
          contexts: {
            os: { name: "macOS" },
            runtime: { name: "node" },
            device: { type: "server" },
            client: { clientId: "123" },
          },
          user: {},
          extra: {},
        }),
      } as any);

      logger.debug("test message");

      expect(mockDebugFn).toHaveBeenCalledWith("%s %O", "test message", {
        "client.clientId": "123",
      });
    });

    it("should enrich debug output with user from Sentry scope", () => {
      vi.mocked(Sentry.getCurrentScope).mockReturnValue({
        getScopeData: () => ({
          tags: {},
          contexts: {},
          user: { id: "user123", username: "testuser" },
          extra: {},
        }),
      } as any);

      logger.warn("test message");

      expect(mockWarnFn).toHaveBeenCalledWith("%s %O", "test message", {
        "user.id": "user123",
        "user.username": "testuser",
      });
    });

    it("should enrich debug output with extras from Sentry scope", () => {
      vi.mocked(Sentry.getCurrentScope).mockReturnValue({
        getScopeData: () => ({
          tags: {},
          contexts: {},
          user: {},
          extra: { traceId: "trace123", spanId: "span456" },
        }),
      } as any);

      logger.error("test error");

      expect(mockErrorFn).toHaveBeenCalledWith("%s %O", "test error", {
        "extra.traceId": "trace123",
        "extra.spanId": "span456",
      });
    });

    it("should merge provided metadata with Sentry scope data", () => {
      vi.mocked(Sentry.getCurrentScope).mockReturnValue({
        getScopeData: () => ({
          tags: { userId: "123" },
          contexts: { client: { id: "client123" } },
          user: { id: "user123" },
          extra: { traceId: "trace123" },
        }),
      } as any);

      logger.debug("test message", { requestId: "xyz", duration: 100 });

      expect(mockDebugFn).toHaveBeenCalledWith("%s %O", "test message", {
        requestId: "xyz",
        duration: 100,
        "tag.userId": "123",
        "client.id": "client123",
        "user.id": "user123",
        "extra.traceId": "trace123",
      });
    });

    it("should not output anything when no metadata and empty Sentry scope", () => {
      vi.mocked(Sentry.getCurrentScope).mockReturnValue({
        getScopeData: () => ({
          tags: {},
          contexts: {},
          user: {},
          extra: {},
        }),
      } as any);

      logger.debug("test message");

      expect(mockDebugFn).toHaveBeenCalledWith("%s", "test message");
    });
  });
});

describe("createLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset getCurrentScope to return empty scope
    vi.mocked(Sentry.getCurrentScope).mockReturnValue({
      getScopeData: vi.fn(() => ({
        tags: {},
        contexts: {},
        user: {},
        extra: {},
      })),
    } as any);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("should return an object with all required Logger methods", () => {
    const logger = createLogger("test-component");

    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("should create debug instances with correct namespaces", () => {
    const component = "auth";
    createLogger(component);

    expect(debugModule).toHaveBeenCalledWith("homed:auth:debug");
    expect(debugModule).toHaveBeenCalledWith("homed:auth:info");
    expect(debugModule).toHaveBeenCalledWith("homed:auth:warn");
    expect(debugModule).toHaveBeenCalledWith("homed:auth:error");
  });

  it("should create debug instances with different component names", () => {
    createLogger("device");

    expect(debugModule).toHaveBeenCalledWith("homed:device:debug");
    expect(debugModule).toHaveBeenCalledWith("homed:device:info");
    expect(debugModule).toHaveBeenCalledWith("homed:device:warn");
    expect(debugModule).toHaveBeenCalledWith("homed:device:error");
  });

  it("should call the underlying debug function when logger methods are invoked", () => {
    const mockDebugFn = vi.fn() as unknown as Debugger;
    mockDebugFn.color = "";
    mockDebugFn.enabled = false;
    mockDebugFn.namespace = "";
    mockDebugFn.diff = 0;
    mockDebugFn.log = vi.fn();
    mockDebugFn.extend = vi.fn();
    mockDebugFn.destroy = vi.fn();

    vi.mocked(debugModule).mockReturnValue(mockDebugFn);

    const logger = createLogger("test");

    logger.debug("test message");
    logger.info("info message");
    logger.warn("warning message");
    logger.error("error message");

    expect(mockDebugFn).toHaveBeenCalledWith("%s", "test message");
    expect(mockDebugFn).toHaveBeenCalledWith("%s", "info message");
    expect(mockDebugFn).toHaveBeenCalledWith("%s", "warning message");
    expect(mockDebugFn).toHaveBeenCalledWith("%s", "error message");
  });

  it("should pass metadata to debug function", () => {
    const mockDebugFn = vi.fn() as unknown as Debugger;
    mockDebugFn.color = "";
    mockDebugFn.enabled = false;
    mockDebugFn.namespace = "";
    mockDebugFn.diff = 0;
    mockDebugFn.log = vi.fn();
    mockDebugFn.extend = vi.fn();
    mockDebugFn.destroy = vi.fn();

    vi.mocked(debugModule).mockReturnValue(mockDebugFn);

    const logger = createLogger("test");
    const meta = { userId: "123", action: "login" };

    logger.debug("test message", meta);
    logger.info("info message", meta);
    logger.warn("warning message", meta);

    expect(mockDebugFn).toHaveBeenCalledWith("%s %O", "test message", meta);
    expect(mockDebugFn).toHaveBeenCalledWith("%s %O", "info message", meta);
    expect(mockDebugFn).toHaveBeenCalledWith("%s %O", "warning message", meta);
  });

  it("should pass error and metadata to error method", () => {
    const mockDebugFn = vi.fn() as unknown as Debugger;
    mockDebugFn.color = "";
    mockDebugFn.enabled = false;
    mockDebugFn.namespace = "";
    mockDebugFn.diff = 0;
    mockDebugFn.log = vi.fn();
    mockDebugFn.extend = vi.fn();
    mockDebugFn.destroy = vi.fn();

    vi.mocked(debugModule).mockReturnValue(mockDebugFn);

    const logger = createLogger("test");
    const error = new Error("Test error");
    const meta = { userId: "123" };

    logger.error("error occurred", error, meta);

    expect(mockDebugFn).toHaveBeenCalledWith("%s %O", "error occurred", error);
  });

  it("should work without metadata", () => {
    const mockDebugFn = vi.fn() as unknown as Debugger;
    mockDebugFn.color = "";
    mockDebugFn.enabled = false;
    mockDebugFn.namespace = "";
    mockDebugFn.diff = 0;
    mockDebugFn.log = vi.fn();
    mockDebugFn.extend = vi.fn();
    mockDebugFn.destroy = vi.fn();

    vi.mocked(debugModule).mockReturnValue(mockDebugFn);

    const logger = createLogger("test");

    logger.debug("test");
    logger.info("test");
    logger.warn("test");
    logger.error("test");

    expect(mockDebugFn).toHaveBeenCalledWith("%s", "test");
  });
});
