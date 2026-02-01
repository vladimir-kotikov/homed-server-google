import debug from "debug";
import appConfig from "./config.ts";
import { HomedServerController } from "./controller.ts";
import { UserRepository } from "./db/repository.ts";
import { DeviceRepository } from "./device.ts";
import { FulfillmentController } from "./google/fulfillment.ts";
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
  appConfig.googleHomeOAuthRedirectUri
);
const fulfillmentController = new FulfillmentController(
  usersRepository,
  deviceRepository
);
const httpHandler = new WebApp(
  usersRepository,
  fulfillmentController,
  oauthController
);

const mainController = new HomedServerController(
  usersRepository,
  deviceRepository,
  httpHandler
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
