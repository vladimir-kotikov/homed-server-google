import { logger } from "@tinyhttp/logger";
import SqliteStore from "better-sqlite3-session-store";
import debug from "debug";
import ejs from "ejs";
import express from "express";
import sessionMiddleware from "express-session";
import type { IncomingMessage, ServerResponse } from "node:http";
import passport from "passport";
import appConfig from "../config.ts";
import type { User, UserRepository } from "../db/repository.ts";
import { FulfillmentController } from "../google/fulfillment.ts";
import {
  clientPasswordOauth20Strategy,
  googleOauth20Strategy,
  jwtStrategy,
  requireLoggedIn,
} from "./middleware.ts";
import { OAuthController } from "./oauth.ts";
import userRoutes from "./user.ts";

export class WebApp {
  readonly app: express.Application;

  private userRepository: UserRepository;
  private oauthController: OAuthController;
  private fulfillmentController: FulfillmentController;

  constructor(
    userRepository: UserRepository,
    fulfillmentController: FulfillmentController,
    oauthController: OAuthController
  ) {
    this.userRepository = userRepository;
    this.fulfillmentController = fulfillmentController;
    this.oauthController = oauthController;

    // eslint-disable-next-line unicorn/no-null
    passport.serializeUser((user, done) => done(null, user));
    // eslint-disable-next-line unicorn/no-null
    passport.deserializeUser((user, done) => done(null, user as User));

    const logging = logger({
      ignore: ["/health"],
      output: { callback: debug("homed:request"), color: false },
    });
    const SessionStore = SqliteStore(sessionMiddleware);
    const session = sessionMiddleware({
      secret: appConfig.cookieSecret,
      name: "homed-google-server-cookie",
      resave: false,
      saveUninitialized: false,
      rolling: true,
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
      .use("/", passport.authenticate("session"), userRoutes)
      .get("/health", (_request, response) => response.json({ status: "ok" }))
      .post(
        "/fulfillment",
        passport.authenticate("jwt", { session: false }),
        requireLoggedIn,
        (request, response) =>
          this.fulfillmentController
            .handleFulfillment(request.user!, request.body)
            .then(response.json)
            .catch(error => response.status(500).json({ error: error.message }))
      )
      .use("/oauth", this.oauthController.routes);
  }

  handleRequest = (request: IncomingMessage, response: ServerResponse) =>
    this.app(request, response);
}
