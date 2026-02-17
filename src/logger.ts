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

export class Logger {
  private readonly component: string;
  private readonly debugInstances: DebugInstances;

  constructor(component: string, debugInstances: DebugInstances) {
    this.component = component;
    this.debugInstances = debugInstances;
  }

  debug(message: string, data?: LogExtra): void {
    this.formatDebugOutput(this.debugInstances.debug, message, data);
    this.addBreadcrumb("debug", message, data);
    Sentry.logger.debug(message, { component: this.component, ...data });
  }

  info(message: string, data?: LogExtra): void {
    this.formatDebugOutput(this.debugInstances.info, message, data);
    this.addBreadcrumb("info", message, data);
    Sentry.logger.info(message, { component: this.component, ...data });
  }

  warn(message: string, data?: LogExtra): void {
    this.formatDebugOutput(this.debugInstances.warn, message, data);
    this.addBreadcrumb("warning", message, data);
    Sentry.logger.warn(message, { component: this.component, ...data });
    Sentry.captureMessage(message, {
      level: "warning",
      extra: data,
      tags: { component: this.component },
    } as Sentry.CaptureContext);
  }

  error(message: string, error?: unknown, data?: LogExtra): void {
    if (error !== undefined) {
      this.debugInstances.error("%s %O", message, error);
    } else {
      this.formatDebugOutput(this.debugInstances.error, message, data);
    }

    this.addBreadcrumb("error", message, data);
    Sentry.logger.error(message, { component: this.component, ...data, error });
    const context = {
      tags: { component: this.component },
      ...(data ? { extra: data } : {}),
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    error
      ? Sentry.captureException(error as Error, context)
      : Sentry.captureMessage(message, {
          level: "error",
          error,
          ...context,
        } as Sentry.CaptureContext);
  }

  /**
   * Format output to debug instance
   * Uses "%s %O" when meta is provided, "%s" when not
   * Enriches output with context from current Sentry scope
   */
  private formatDebugOutput(
    debugFn: Debugger,
    message: string,
    data?: LogExtra
  ): void {
    const enrichedMeta = this.enrichLogExtra(data);
    if (enrichedMeta !== undefined && Object.keys(enrichedMeta).length > 0) {
      debugFn("%s %O", message, enrichedMeta);
    } else {
      debugFn("%s", message);
    }
  }

  /**
   * Enrich metadata by reading from Sentry's current scope
   * This ensures console logs show the same context that Sentry events receive
   */
  private enrichLogExtra(data: LogExtra = {}): LogExtra {
    const { tags, user, extra, contexts } =
      Sentry.getCurrentScope().getScopeData();
    // Skip contexts for now to avoid polluting debug logs
    return {
      ...data,
      ...mapDict(tags, (key, value) => [`tag.${key}`, value]),
      ...mapDict(user, (key, value) => [`user.${key}`, value]),
      ...mapDict(extra, (key, value) => [`extra.${key}`, value]),
      // Merge client context if available, prefixing keys to avoid collisions
      ...mapDict(contexts.client ?? {}, (key, value) => [
        `client.${key}`,
        value,
      ]),
      ...mapDict(contexts.connection ?? {}, (key, value) => [
        `connection.${key}`,
        value,
      ]),
    };
  }

  private addBreadcrumb = (
    level: Sentry.SeverityLevel,
    message: string,
    data: LogExtra | undefined
  ) =>
    Sentry.addBreadcrumb({
      type: level,
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
