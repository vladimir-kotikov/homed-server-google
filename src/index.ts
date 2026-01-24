import appConfig from "./config.ts";
import { HomedServerController } from "./controller.ts";
import { UserRepository } from "./db/repository.ts";
import { WebApp } from "./web/app.ts";
import { OAuthController } from "./web/oauth.ts";
import { SmartHomeController } from "./web/smarthome.ts";

const { databaseUrl, tcpPort, httpPort } = appConfig;

// Initialize database before starting servers
const usersRepository = UserRepository.open(databaseUrl, { create: true });
const oauthController = new OAuthController(
  usersRepository,
  appConfig.jwtSecret,
  appConfig.oauthClientId,
  appConfig.oauthClientSecret,
  appConfig.oauthRedirectUri,
  appConfig.accessTokenLifetime,
  appConfig.refreshTokenLifetime
);

const smarthomeController = new SmartHomeController(usersRepository);

const httpHandler = new WebApp(
  usersRepository,
  smarthomeController,
  oauthController
);

const controller = new HomedServerController(usersRepository, httpHandler);

const shutdown = async () => {
  console.log("Shutting down...");
  controller.stop();
  usersRepository.close();
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

controller.start(httpPort, tcpPort);
