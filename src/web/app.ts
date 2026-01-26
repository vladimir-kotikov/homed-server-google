import ejs from "ejs";
import express from "express";
import session from "express-session";
import type { IncomingMessage, ServerResponse } from "node:http";
import passport from "passport";
import appConfig from "../config.ts";
import type { User, UserRepository } from "../db/repository.ts";
import {
  clientPasswordOauth20Strategy,
  googleOauth20Strategy,
  jwtStrategy,
} from "./authStrategies.ts";
import { OAuthController } from "./oauth.ts";
import { SmartHomeController } from "./smarthome.ts";
import userRoutes from "./user.ts";

export class WebApp {
  readonly app: express.Application;

  private userRepository: UserRepository;
  private oauthController: OAuthController;
  private smarthomeController: SmartHomeController;

  constructor(
    userRepository: UserRepository,
    smartHomeController: SmartHomeController,
    oauthController: OAuthController
  ) {
    this.userRepository = userRepository;
    this.smarthomeController = smartHomeController;
    this.oauthController = oauthController;

    // eslint-disable-next-line unicorn/no-null
    passport.serializeUser((user, done) => done(null, user));
    // eslint-disable-next-line unicorn/no-null
    passport.deserializeUser((user, done) => done(null, user as User));

    this.app = express()
      .set("views", "templates")
      .set("view engine", "html")
      .engine("html", ejs.renderFile)
      .use(
        passport
          .use(
            "jwt",
            jwtStrategy(
              appConfig.jwtSecret,
              this.userRepository.verifyAccessTokenPayload
            )
          )
          .use(
            "google-oauth20",
            googleOauth20Strategy(
              appConfig.googleSsoClientId,
              appConfig.googleSsoClientSecret,
              appConfig.googleSsoRedirectUri,
              ({ id, emails }) =>
                this.userRepository.getOrCreate(id, emails![0].value)
            )
          )
          .use(
            "client-password-oauth20",
            clientPasswordOauth20Strategy(
              appConfig.googleHomeOAuthClientId,
              appConfig.googleHomeOAuthClientSecret
            )
          )
          .initialize()
      )
      .use(express.static("public"))
      .use(express.json())
      .use(
        session({
          secret: appConfig.cookieSecret,
          name: "homed-google-server-cookie",
          resave: false,
          saveUninitialized: true,
          rolling: true,
        })
      )
      .get("/health", (_request, response) => response.json({ status: "ok" }))
      .use("/", passport.authenticate("session"), userRoutes)
      .use("/oauth", this.oauthController.routes)
      .use(this.smarthomeController.routes);
  }

  handleRequest = (request: IncomingMessage, response: ServerResponse) =>
    this.app(request, response);
}
