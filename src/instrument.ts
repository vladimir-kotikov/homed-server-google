import { registerInstrumentations } from "@opentelemetry/instrumentation";
import * as Sentry from "@sentry/node";
import { BetterSqlite3Instrumentation } from "opentelemetry-plugin-better-sqlite3";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  enableLogs: true,
  enableMetrics: true,
  tracesSampleRate: 0.2,
  integrations: [
    Sentry.httpIntegration(),
    Sentry.httpServerIntegration(),
    Sentry.httpServerSpansIntegration(),
    Sentry.requestDataIntegration(),
    Sentry.expressIntegration(),
    Sentry.processSessionIntegration(),
    Sentry.localVariablesIntegration({ captureAllExceptions: true }),
    Sentry.zodErrorsIntegration(),
  ],
  includeLocalVariables: true,
  sendClientReports: true,
  sendDefaultPii: true,
  beforeSendTransaction: transaction =>
    // Ignore health check transactions
    // eslint-disable-next-line unicorn/no-null
    transaction.transaction === "GET /health" ? null : transaction,
});

// Register custom OpenTelemetry instrumentations after Sentry.init
// Sentry manages the OpenTelemetry SDK internally, so we just register additional instrumentations
registerInstrumentations({
  instrumentations: [new BetterSqlite3Instrumentation()],
});
