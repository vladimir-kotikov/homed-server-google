/* eslint-disable @typescript-eslint/no-namespace */
import * as Sentry from "@sentry/node";
import { logger } from "@tinyhttp/logger";
import SqliteStore from "better-sqlite3-session-store";
import { ensureLoggedIn, ensureLoggedOut } from "connect-ensure-login";
import debug from "debug";
import ejs from "ejs";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import rateLimit, {
  type RateLimitExceededEventHandler,
} from "express-rate-limit";
import sessionMiddleware from "express-session";
import helmet from "helmet";
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
import { createLogger } from "../logger.ts";
import {
  bearerAuthMiddleware,
  clientPasswordOauth20Strategy,
  debugLoggedIn,
  googleOauth20Strategy,
  requireLoggedIn,
  setSentryUser,
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

const log = createLogger("web");

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

    // Store only user ID in session, then look up from database on each request
    // This ensures session data is always validated against current database state
    // eslint-disable-next-line unicorn/no-null
    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser((id, done) => {
      return typeof id !== "string"
        ? // eslint-disable-next-line unicorn/no-null
          done(null, false)
        : this.userRepository
            .getById(id as UserId)
            // eslint-disable-next-line unicorn/no-null
            .then(user => done(null, user ?? false))
            .catch(error => {
              log.error("session.deserializeUser.error", error, { userId: id });
              // eslint-disable-next-line unicorn/no-null
              return done(null, false);
            });
    });

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

    const bearerAuthentication = bearerAuthMiddleware(
      this.userRepository.verifyAccessToken
    );

    const googleSSOAuthentication = googleOauth20Strategy(
      appConfig.googleSsoClientId,
      appConfig.googleSsoClientSecret,
      appConfig.googleSsoRedirectUri,
      ({ id, emails }) =>
        this.userRepository.getOrCreate(id as UserId, emails![0].value)
    );

    const clientOauthAuthentication = clientPasswordOauth20Strategy(
      appConfig.googleHomeOAuthClientId,
      appConfig.googleHomeOAuthClientSecret
    );

    const authentication = passport
      .use("google-oauth20", googleSSOAuthentication)
      .use("client-password-oauth20", clientOauthAuthentication)
      .initialize();

    const skipHealthChecks = (req: Request) =>
      (appConfig.healthcheckIps ?? []).includes(req.ip ?? "");

    const onRateLimitExceeded: RateLimitExceededEventHandler = (
      req,
      res,
      _next,
      options
    ) => {
      log.warn("rate_limit.exceeded", { ip: req.ip, path: req.path });
      res.status(options.statusCode).send(options.message);
    };

    this.app = express()
      .disable("x-powered-by")
      // 2 hops are needded for Cloudflare + fly.io proxies
      .set("trust proxy", 2)
      .set("views", "templates")
      .set("view engine", "html")
      .engine("html", ejs.renderFile)
      .use(logging)
      .use(express.static("public"))
      .use(express.json())
      .use(session)
      .use(authentication)
      .use(passport.session())
      .use(setSentryUser)
      .use(helmet())
      .get(
        "/",
        passport.authenticate("session"),
        ensureLoggedIn("/login"),
        this.handleHome
      )
      .get(
        "/login",
        rateLimit({
          windowMs: 15 * 60 * 1000,
          max: 5,
          skip: skipHealthChecks,
          handler: onRateLimitExceeded,
        }),
        ensureLoggedOut("/"),
        (_, res) => res.render("signin")
      )
      .get(
        "/auth/google",
        rateLimit({
          max: 10,
          skip: skipHealthChecks,
          handler: onRateLimitExceeded,
        }),
        passport.authenticate("google-oauth20")
      )
      .get(
        "/auth/google/callback",
        passport.authenticate("google-oauth20", { keepSessionInfo: true }),
        this.handleAuthCallback
      )
      .get("/logout", (req, res, next) =>
        req.logOut(err => (err ? next(err) : res.redirect("/login")))
      )
      .get("/health", (_, res) => res.json({ status: "ok" }))
      .post(
        "/fulfillment",
        rateLimit({
          max: 100,
          skip: skipHealthChecks,
          handler: onRateLimitExceeded,
        }),
        debugLoggedIn,
        bearerAuthentication,
        setSentryUser,
        requireLoggedIn,
        this.handleFulfillment
      )
      .use("/oauth", this.oauthController.routes);

    if (
      process.env.NODE_ENV !== "production" &&
      process.env.HOMED_USER_ID &&
      process.env.HOMED_CLIENT_ID
    ) {
      console.log("[APP INIT] Setting up /inspect and /fulfillment-dev routes");
      this.app = this.app
        .post(
          "/fulfillment-dev",
          debugLoggedIn,
          requireLoggedIn,
          this.handleFulfillment
        )
        .use("/inspect", debugLoggedIn, (req, res) => {
          console.log("[INSPECT] Request received");
          return res.json({
            user: req.user,
            session: req.session,
            devices: this.deviceRepository.getDevices(req.user!.id),
            state: this.deviceRepository.getDevicesStates(req.user!.id),
          });
        });
    }

    Sentry.setupExpressErrorHandler(this.app);
  }

  private handleHome = (request: Request, response: Response) => {
    const user = (request as Express.AuthenticatedRequest).user;
    response.render("dashboard", {
      user,
      connectedClients: this.deviceRepository.getConnectedClientIds(user.id),
    });
  };

  private handleAuthCallback = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const redirectUrl = req.session.returnTo ?? "/";
    delete req.session.returnTo;
    return req.user
      ? req.session.regenerate(err =>
          err
            ? next(err)
            : req.login(req.user!, err =>
                err ? next(err) : res.redirect(redirectUrl)
              )
        )
      : res.redirect(redirectUrl);
  };

  private handleFulfillment = (req: Request, res: Response) =>
    this.fulfillmentController
      .handleFulfillment((req as Express.AuthenticatedRequest).user, req.body)
      .then(data => res.json(data));

  handleRequest = (request: IncomingMessage, response: ServerResponse) =>
    this.app(request, response);
}
