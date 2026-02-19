/* eslint-disable @typescript-eslint/no-namespace */
import * as Sentry from "@sentry/node";
import { logger } from "@tinyhttp/logger";
import SqliteStore from "better-sqlite3-session-store";
import { ensureLoggedIn, ensureLoggedOut } from "connect-ensure-login";
import debug from "debug";
import ejs from "ejs";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
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
import {
  clientPasswordOauth20Strategy,
  debugLoggedIn,
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

    const jwtAuthentication = jwtStrategy(
      appConfig.jwtSecret,
      this.userRepository.verifyAccessTokenPayload
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
      .use("jwt", jwtAuthentication)
      .use("google-oauth20", googleSSOAuthentication)
      .use("client-password-oauth20", clientOauthAuthentication)
      .initialize();

    this.app = express()
      .disable("x-powered-by")
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
      .use(helmet())
      .get(
        "/",
        passport.authenticate("session"),
        ensureLoggedIn("/login"),
        this.handleHome
      )
      .get(
        "/login",
        rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }),
        ensureLoggedOut("/"),
        (_, res) => res.render("signin")
      )
      .get(
        "/auth/google",
        rateLimit({ max: 10 }),
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
        rateLimit({ max: 100 }),
        passport.authenticate("jwt", { session: false }),
        debugLoggedIn,
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
    const {
      user: { id, clientToken, username },
    } = request as Express.AuthenticatedRequest;
    response.render("dashboard", {
      username: id,
      email: username, // username is actually the email from Google
      clientToken,
      connectedClients: this.deviceRepository.getConnectedClientIds(id),
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
