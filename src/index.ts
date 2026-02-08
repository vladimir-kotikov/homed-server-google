import debug from "debug";
import appConfig from "./config.ts";
import { HomedServerController } from "./controller.ts";
import { UserRepository } from "./db/repository.ts";
import { DeviceRepository } from "./device.ts";
import { FulfillmentController } from "./google/fulfillment.ts";
import { HomeGraphClient } from "./google/homeGraph.ts";
import { WebApp } from "./web/app.ts";
import { OAuthController } from "./web/oauth.ts";

const log = debug("homed:main");
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

// Initialize HomeGraph client if service account is configured
const homeGraphClient = appConfig.googleServiceAccountJson
  ? new HomeGraphClient(appConfig.googleServiceAccountJson)
  : undefined;

if (homeGraphClient) {
  log("Google Home state reporting enabled");
} else {
  log("Google Home state reporting disabled (no service account configured)");
}

const sslOptions =
  appConfig.sslCert && appConfig.sslKey
    ? { cert: appConfig.sslCert, key: appConfig.sslKey }
    : undefined;

const mainController = new HomedServerController(
  usersRepository,
  deviceRepository,
  httpHandler,
  homeGraphClient,
  sslOptions
);

const shutdown = async () => {
  log("Shutting down...");
  mainController.stop();
  usersRepository.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

mainController.start(httpPort, tcpPort);
