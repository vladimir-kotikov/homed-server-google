import * as Sentry from "@sentry/node";

const sentry_environment = Object.keys(process.env).filter(key =>
  key.startsWith("SENTRY_")
);

if (sentry_environment.length > 0) {
  console.log(`Sentry environment variables: ${sentry_environment.join(", ")}`);
}

if (process.env.SENTRY_DSN !== "") {
  console.log(
    `Initializing Sentry with DSN: ${process.env.SENTRY_DSN} \
    environment: ${process.env.NODE_ENV}`
  );
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    enableLogs: true,
    tracesSampleRate: 1.0,
    integrations: [
      Sentry.expressIntegration(),
      Sentry.zodErrorsIntegration(),
      Sentry.consoleIntegration(),
      Sentry.httpServerIntegration(),
    ],
  });
}
