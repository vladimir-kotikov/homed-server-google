import * as Sentry from "@sentry/node";
import { BetterSqlite3Instrumentation } from "opentelemetry-plugin-better-sqlite3";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enableLogs: true,
  tracesSampleRate: 1,
  integrations: [
    Sentry.httpIntegration(),
    Sentry.httpServerIntegration(),
    Sentry.httpServerSpansIntegration(),
    Sentry.requestDataIntegration(),
    Sentry.expressIntegration(),
    Sentry.processSessionIntegration(),
    Sentry.consoleIntegration({ levels: ["error", "warn"] }),
    Sentry.consoleLoggingIntegration(),
    Sentry.localVariablesIntegration({ captureAllExceptions: true }),
    Sentry.zodErrorsIntegration(),
  ],
  openTelemetryInstrumentations: [new BetterSqlite3Instrumentation()],
  enableMetrics: true,
  includeLocalVariables: true,
  sendClientReports: true,
  sendDefaultPii: true,
  beforeSendTransaction(transaction) {
    // Ignore health check transactions
    if (transaction.transaction === "GET /health") {
      // eslint-disable-next-line unicorn/no-null
      return null;
    }
    return transaction;
  },
});
