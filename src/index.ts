import * as Sentry from "@sentry/node";
import appConfig from "./config.ts";
import { HomedServerController } from "./controller.ts";
import { UserRepository } from "./db/repository.ts";
import { DeviceRepository } from "./device.ts";
import { FulfillmentController } from "./google/fulfillment.ts";
import { createLogger } from "./logger.ts";
import { WebApp } from "./web/app.ts";
import { OAuthController } from "./web/oauth.ts";

const log = createLogger("main");

const { databaseUrl, tcpPort, httpPort } = appConfig;

const deviceRepository = new DeviceRepository();
const usersRepository = UserRepository.open(databaseUrl, appConfig.jwtSecret, {
  create: true,
  accessTokenLifetime: appConfig.accessTokenLifetime,
  refreshTokenLifetime: appConfig.refreshTokenLifetime,
});

const oauthController = new OAuthController(
  usersRepository,
  appConfig.googleHomeOAuthClientId,
  appConfig.googleHomeProjectId
);

const fulfillmentController = new FulfillmentController(
  usersRepository,
  deviceRepository
);
const httpHandler = new WebApp(
  usersRepository,
  fulfillmentController,
  oauthController,
  deviceRepository
);

const sslOptions =
  appConfig.sslCert && appConfig.sslKey
    ? { cert: appConfig.sslCert, key: appConfig.sslKey }
    : undefined;

const mainController = new HomedServerController(
  usersRepository,
  deviceRepository,
  httpHandler,
  sslOptions,
  appConfig.healthcheckIps
);

const shutdown = (signal: string) => {
  log.info(`Received ${signal}, shutting down gracefully...`);
  return mainController
    .stop()
    .then(() => Sentry.close(2000))
    .then(() => process.exit(0))
    .catch(error => {
      log.error("Error during shutdown:", error);
      process.exit(1);
    });
};

process.on("SIGTERM", shutdown).on("SIGINT", shutdown);

mainController.start(httpPort, tcpPort);
Sentry.metrics.count("server.start");
