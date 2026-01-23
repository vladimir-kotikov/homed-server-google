import express from "express";
import { engine } from "express-handlebars";
import session from "express-session";
import type { IncomingMessage, ServerResponse } from "node:http";
import appConfig from "../config.ts";
import type { UserRepository } from "../db/repository.ts";
import { OAuthController } from "./oauth.ts";
import { SmartHomeController } from "./smarthome.ts";
import { UserController } from "./user.ts";

const { env, cookieSecret } = appConfig;

export class WebApp {
  app: express.Application;
  private oauthController: OAuthController;
  private smarthomeController: SmartHomeController;
  private userController: UserController;

  constructor(
    userRepository: UserRepository,
    clientOauthParameters: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    },
    serverOauthParameters: {
      clientId: string;
      clientSecret: string;
      jwtSecret: string;
      accessTokenExpiresIn?: string;
      refreshTokenExpiresIn?: string;
    }
  ) {
    const clientVerifier = (clientId: string, clientSecret: string) => {
      return (
        clientId === clientOauthParameters.clientId &&
        clientSecret === clientOauthParameters.clientSecret
      );
    };

    this.oauthController = new OAuthController(
      userRepository,
      serverOauthParameters.jwtSecret,
      clientVerifier,
      serverOauthParameters.accessTokenExpiresIn,
      serverOauthParameters.refreshTokenExpiresIn
    );

    this.smarthomeController = new SmartHomeController(
      userRepository,
      (token: string) => this.oauthController.verifyAccessToken(token),
      new DeviceService()
    );

    this.userController = new UserController(
      clientOauthParameters.clientId,
      clientOauthParameters.clientSecret,
      clientOauthParameters.redirectUri
    );

    this.app = express()
      .engine("handlebars", engine({ defaultLayout: false }))
      .set("view engine", "handlebars")
      .set("views", "./templates")
      .use(express.static("public"))
      .use(express.json())
      .use(
        session({
          secret: cookieSecret,
          resave: false,
          saveUninitialized: false,
          cookie: {
            secure: env === "production",
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          },
        })
      )
      .get("/health", (_request, response) => response.json({ status: "ok" }))
      .use("/", this.userController.routes)
      .use("/oauth", this.oauthController.routes)
      .use(this.smarthomeController.routes);
  }

  handleRequest = (request: IncomingMessage, response: ServerResponse) =>
    this.app(request, response);
}
