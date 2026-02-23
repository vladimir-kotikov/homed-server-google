import { registerInstrumentations } from "@opentelemetry/instrumentation";
import * as Sentry from "@sentry/node";
import { BetterSqlite3Instrumentation } from "opentelemetry-plugin-better-sqlite3";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
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
  // Bridge new OTel semantic convention attribute names to the legacy names
  // that Sentry's Queries insights panel still requires.
  // opentelemetry-plugin-better-sqlite3 uses the new OTel 1.29+ names
  // (db.system.name, db.query.text) but the panel looks for db.system and
  // db.statement to classify and populate DB query spans. The panel also
  // uses span.description as the query text, and requires span.op = "db".
  // Note: Sentry determines op from OTel attributes before beforeSendSpan
  // runs, so we must set op and description explicitly here.
  beforeSendSpan: span => {
    const data = span.data as Record<string, unknown> | undefined;
    if (!data) return span;

    const systemName = data["db.system.name"] as string | undefined;
    const queryText = data["db.query.text"] as string | undefined;

    if (systemName) {
      data["db.system"] = systemName;
      span.op = "db";
    }
    if (queryText) {
      data["db.statement"] = queryText;
      span.description = queryText;
    }

    return span;
  },
});

// Register custom OpenTelemetry instrumentations after Sentry.init
// Sentry manages the OpenTelemetry SDK internally, so we just register additional instrumentations
registerInstrumentations({
  instrumentations: [new BetterSqlite3Instrumentation()],
});
