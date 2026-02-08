/* eslint-disable @typescript-eslint/no-namespace */
import * as Sentry from "@sentry/node";
import { logger } from "@tinyhttp/logger";
import SqliteStore from "better-sqlite3-session-store";
import { ensureLoggedIn, ensureLoggedOut } from "connect-ensure-login";
import debug from "debug";
import ejs from "ejs";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import sessionMiddleware from "express-session";
import type { IncomingMessage, ServerResponse } from "node:http";
import passport from "passport";
import appConfig from "../config.ts";
import type {
  ClientToken,
  User as HomedUser,
  User,
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
      .use(logging)
      .disable("x-powered-by")
      .set("trust proxy", 2)
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
      .get("/login", ensureLoggedOut("/"), (_, res) => res.render("signin"))
      .get("/auth/google", passport.authenticate("google-oauth20"))
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
        (req, res, next) => {
          const log = debug("homed:fulfillment");

          // DEV MODE: Skip authentication if NODE_ENV is not production
          if (process.env.NODE_ENV !== "production") {
            log("DEV MODE: Skipping JWT authentication");
            // Create a mock user for testing
            req.user = {
              id: (process.env.DEV_USER_ID ||
                "105970409134870248485") as UserId,
              username: "dev-user@test.local",
              clientToken: (process.env.DEV_CLIENT_TOKEN ||
                "dev-token-123") as ClientToken,
              createdAt: new Date(),
            } satisfies User;
            return next();
          }

          passport.authenticate("jwt", { session: false })(req, res, next);
        },
        requireLoggedIn,
        this.handleFulfillment
      )
      .use("/oauth", this.oauthController.routes);

    Sentry.setupExpressErrorHandler(this.app);
  }

  private handleHome = (request: Request, response: Response) => {
    const {
      user: { id, clientToken },
    } = request as Express.AuthenticatedRequest;
    response.render("dashboard", {
      username: id,
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

  private handleFulfillment = async (req: Request, res: Response) => {
    const data = await this.fulfillmentController.handleFulfillment(
      (req as Express.AuthenticatedRequest).user,
      req.body
    );
    res.json(data);
  };

  handleRequest = (request: IncomingMessage, response: ServerResponse) =>
    this.app(request, response);
}
