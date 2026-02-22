/**
 * Structured logging for Homed Server
 * Provides logging with debug output and Sentry integration
 */

import * as Sentry from "@sentry/node";
import debug, { type Debugger } from "debug";
import { mapDict } from "./utility.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogExtra = Record<string, unknown>;

export interface DebugInstances {
  debug: Debugger;
  info: Debugger;
  warn: Debugger;
  error: Debugger;
}

/**
 * Sentry-managed internal context names injected automatically by the SDK
 * (OS details, runtime, hardware, etc.). These add noise to log output and
 * are already visible in Sentry's built-in context panels.
 */
const SENTRY_INTERNAL_CONTEXTS = new Set([
  "os",
  "runtime",
  "app",
  "browser",
  "device",
  "gpu",
  "culture",
  "memory_info",
  "trace",
  "state",
  "transaction",
]);

export class Logger {
  private readonly component: string;
  private readonly loggers: DebugInstances;

  constructor(component: string, loggers: DebugInstances) {
    this.component = component;
    this.loggers = loggers;
  }

  debug(message: string, extra?: LogExtra): void {
    const enriched = this.mergeSentryScopeData(extra);
    this.log(this.loggers.debug, message, enriched);
    this.addBreadcrumb("debug", message, extra);
    Sentry.logger.debug(message, { component: this.component, ...enriched });
  }

  info(message: string, data?: LogExtra): void {
    const enriched = this.mergeSentryScopeData(data);
    this.log(this.loggers.info, message, enriched);
    this.addBreadcrumb("info", message, data);
    Sentry.logger.info(message, { component: this.component, ...enriched });
  }

  warn(message: string, data?: LogExtra): void {
    const enriched = this.mergeSentryScopeData(data);
    this.log(this.loggers.warn, message, enriched);
    this.addBreadcrumb("warning", message, data);
    Sentry.logger.warn(message, { component: this.component, ...enriched });
    Sentry.captureMessage(message, this.getCaptureContext("warning", data));
  }

  error(message: string, error?: unknown, data?: LogExtra): void {
    const enriched = this.mergeSentryScopeData(data);
    if (error !== undefined) {
      this.loggers.error("%s %O", message, error);
    } else {
      this.log(this.loggers.error, message, enriched);
    }

    this.addBreadcrumb("error", message, data);
    Sentry.logger.error(message, {
      component: this.component,
      ...enriched,
      error,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    error
      ? Sentry.captureException(error, this.getCaptureContext("error", data))
      : Sentry.captureMessage(message, this.getCaptureContext("error", data));
  }

  /**
   * Format output to debug instance
   * Uses "%s %O" when meta is provided, "%s" when not
   */
  private log(logFn: Debugger, message: string, extra?: LogExtra): void {
    if (extra !== undefined && Object.keys(extra).length > 0) {
      logFn("%s %O", message, extra);
    } else {
      logFn("%s", message);
    }
  }

  /**
   * Enrich metadata by merging from both Sentry's isolation scope and current
   * scope. Context set in withIsolationScope() lives on the isolation scope and
   * persists through async boundaries, but is NOT visible via getCurrentScope().
   * Current scope takes precedence on conflicts.
   */
  private mergeSentryScopeData(data: LogExtra = {}): LogExtra {
    const isolationData = Sentry.getIsolationScope().getScopeData();
    const currentData = Sentry.getCurrentScope().getScopeData();

    const tags = { ...isolationData.tags, ...currentData.tags };
    const user = { ...isolationData.user, ...currentData.user };
    const extra = { ...isolationData.extra, ...currentData.extra };
    const contexts = { ...isolationData.contexts, ...currentData.contexts };

    // Flatten domain contexts into log output with prefixes,
    // skipping Sentry-internal context names
    const contextEntries = Object.entries(contexts)
      .filter(([contextName]) => !SENTRY_INTERNAL_CONTEXTS.has(contextName))
      .flatMap(([contextName, contextData]) =>
        contextData
          ? Object.entries(contextData as Record<string, unknown>).map(
              ([key, value]) =>
                [`${contextName}.${key}`, value] as [string, unknown]
            )
          : []
      );

    return {
      ...data,
      ...mapDict(tags, (key, value) => [`tag.${key}`, value]),
      ...mapDict(user, (key, value) => [`user.${key}`, value]),
      ...mapDict(extra, (key, value) => [`extra.${key}`, value]),
      ...Object.fromEntries(contextEntries),
    };
  }

  private getCaptureContext = (
    level: Sentry.SeverityLevel,
    extra?: LogExtra
  ): Sentry.CaptureContext =>
    ({
      level,
      tags: { component: this.component },
      ...(extra && Object.keys(extra).length > 0 ? { extra } : {}),
    }) as Sentry.CaptureContext;

  private addBreadcrumb = (
    level: Sentry.SeverityLevel,
    message: string,
    data: LogExtra | undefined
  ) =>
    Sentry.addBreadcrumb({
      type: level === "debug" || level === "error" ? level : "default",
      level: level,
      category: this.component.replace(":", "."),
      message,
      ...(data ? { data } : {}),
    });
}

/**
 * Creates a structured logger for a specific component
 * Uses the debug module with namespace pattern: homed:${component}:${level}
 *
 * @param component - The component name (e.g., 'auth', 'device', 'fulfillment')
 * @returns A Logger instance with debug, info, warn, and error methods
 */
export const createLogger = (component: string) =>
  new Logger(component, {
    debug: debug(`homed:${component}:debug`),
    info: debug(`homed:${component}:info`),
    warn: debug(`homed:${component}:warn`),
    error: debug(`homed:${component}:error`),
  });
