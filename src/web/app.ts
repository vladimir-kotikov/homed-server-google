/* eslint-disable @typescript-eslint/no-namespace */
import * as Sentry from "@sentry/node";
import { logger } from "@tinyhttp/logger";
import SqliteStore from "better-sqlite3-session-store";
import { ensureLoggedIn, ensureLoggedOut } from "connect-ensure-login";
import debug from "debug";
import ejs from "ejs";
import express from "express";
import sessionMiddleware from "express-session";
import type { IncomingMessage, ServerResponse } from "node:http";
import passport from "passport";
import appConfig from "../config.ts";
import type {
  User as HomedUser,
  UserId,
  UserRepository,
} from "../db/repository.ts";
import type { DeviceRepository } from "../device.ts";
import { FulfillmentController } from "../google/fulfillment.ts";
import {
  clientPasswordOauth20Strategy,
  googleOauth20Strategy,
  jwtStrategy,
  requireLoggedIn,
} from "./middleware.ts";
import { OAuthController } from "./oauth.ts";

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends HomedUser {}
  }
}

declare module "express-session" {
  interface SessionData {
    returnTo?: string;
  }
}

export class WebApp {
  readonly app: express.Application;

  private userRepository: UserRepository;
  private oauthController: OAuthController;
  private fulfillmentController: FulfillmentController;
  private deviceRepository: DeviceRepository;

  constructor(
    userRepository: UserRepository,
    fulfillmentController: FulfillmentController,
    oauthController: OAuthController,
    deviceRepository: DeviceRepository
  ) {
    this.userRepository = userRepository;
    this.fulfillmentController = fulfillmentController;
    this.oauthController = oauthController;
    this.deviceRepository = deviceRepository;

    // eslint-disable-next-line unicorn/no-null
    passport.serializeUser((user, done) => done(null, user));
    // eslint-disable-next-line unicorn/no-null
    passport.deserializeUser((user, done) => done(null, user as HomedUser));

    const logging = logger({
      ignore: ["/health"],
      output: { callback: debug("homed:request"), color: false },
    });
    const SessionStore = SqliteStore(sessionMiddleware);
    const session = sessionMiddleware({
      secret: appConfig.cookieSecret,
      resave: false,
      saveUninitialized: false,
      store: new SessionStore({
        client: this.userRepository.database,
        expired: {
          clear: true,
          intervalMs: 900_000, // Clear expired sessions every 15 minutes
        },
      }),
      cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        secure: appConfig.env === "production",
        sameSite: "lax",
      },
    });

    const authentication = passport
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
            this.userRepository.getOrCreate(id as UserId, emails![0].value)
        )
      )
      .use(
        "client-password-oauth20",
        clientPasswordOauth20Strategy(
          appConfig.googleHomeOAuthClientId,
          appConfig.googleHomeOAuthClientSecret
        )
      )
      .initialize();

    this.app = express()
      .use(logging)
      .disable("x-powered-by")
      .set("trust proxy", true)
      .set("views", "templates")
      .set("view engine", "html")
      .engine("html", ejs.renderFile)
      .use(express.static("public"))
      .use(express.json())
      .use(session)
      .use(authentication)
      .use(passport.session())
      .get(
        "/",
        passport.authenticate("session"),
        ensureLoggedIn("/login"),
        this.handleHome
      )
      .get("/login", ensureLoggedOut("/"), (_request, response) =>
        response.render("signin", {
          isTest: process.env.NODE_ENV === "test",
        })
      )
      .get(
        "/auth/google",
        passport.authenticate("google-oauth20", { scope: ["profile", "email"] })
      )
      .get(
        "/auth/google/callback",
        passport.authenticate("google-oauth20", { keepSessionInfo: true }),
        this.handleAuthGoogleCallback
      )
      .get("/logout", (request, response) =>
        request.session.destroy(() => response.redirect("/"))
      )
      .get("/health", (_request, response) => response.json({ status: "ok" }))
      .post(
        "/fulfillment",
        passport.authenticate("jwt", { session: false }),
        requireLoggedIn,
        this.handleFulfillment
      )
      .use("/oauth", this.oauthController.routes);

    Sentry.setupExpressErrorHandler(this.app);
  }

  private handleHome = (
    request: express.Request,
    response: express.Response
  ) => {
    const {
      user: { id, clientToken },
    } = request as Express.AuthenticatedRequest;
    const connectedClients = this.deviceRepository.getConnectedClientIds(id);
    response.render("dashboard", {
      username: id,
      clientToken,
      connectedClients,
    });
  };

  private handleAuthGoogleCallback = (
    request: express.Request,
    response: express.Response
  ) => {
    const redirectUrl = request.session.returnTo ?? "/";
    delete request.session.returnTo;
    response.redirect(redirectUrl);
  };

  private handleFulfillment = (
    request: express.Request,
    response: express.Response
  ) => {
    this.fulfillmentController
      .handleFulfillment(request.user!, request.body)
      .then(response.json)
      .catch(error => response.status(500).json({ error: error.message }));
  };

  handleRequest = (request: IncomingMessage, response: ServerResponse) =>
    this.app(request, response);
}
