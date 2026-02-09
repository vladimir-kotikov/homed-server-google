import * as Sentry from "@sentry/node";
import debug from "debug";
import appConfig from "./config.ts";
import { HomedServerController } from "./controller.ts";
import { UserRepository } from "./db/repository.ts";
import { DeviceRepository } from "./device.ts";
import { FulfillmentController } from "./google/fulfillment.ts";
import { WebApp } from "./web/app.ts";
import { OAuthController } from "./web/oauth.ts";

const log = debug("homed:main");
const logError = debug("homed:main:error");
const { databaseUrl, tcpPort, httpPort } = appConfig;

const deviceRepository = new DeviceRepository();
const usersRepository = UserRepository.open(databaseUrl, appConfig.jwtSecret, {
  create: true,
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
  sslOptions
);

const shutdown = (signal: string) => {
  log(`Received ${signal}, shutting down gracefully...`);
  return mainController
    .stop()
    .then(() => Sentry.close(2000))
    .then(() => {
      log("Shutdown complete");
      process.exit(0);
    })
    .catch(error => {
      logError("Error during shutdown:", error);
      process.exit(1);
    });
};

process.on("SIGTERM", shutdown).on("SIGINT", shutdown);

mainController.start(httpPort, tcpPort);
