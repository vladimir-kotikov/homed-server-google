/* eslint-disable unicorn/no-null */
import * as Sentry from "@sentry/node";
import type { NextFunction, Request, Response } from "express";
import {
  Strategy as GoogleOauth20Strategy,
  type Profile,
} from "passport-google-oauth20";
import { Strategy as ClientPasswordStrategy } from "passport-oauth2-client-password";
import { type ClientToken, type User, type UserId } from "../db/repository.ts";
import { createLogger } from "../logger.ts";

const logger = createLogger("web.middleware");

declare type Maybe<T> = T | undefined;
declare type MaybeAsync<T> = T | Promise<T>;

// Authenticates Google Smarthome API endpoint with an opaque Bearer
// token. The token is verified by the UserRepository
// (AES-256-GCM decryption). Skips verification if the request is already
// authenticated (e.g. by debugLoggedIn in dev environments).
export const bearerAuthMiddleware =
  (verifyToken: (token: string) => Promise<Express.User | undefined>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (req.user) return next();
    const authHeader = req.headers.authorization;
    return authHeader?.startsWith("Bearer ")
      ? verifyToken(authHeader.slice(7))
          .then(user => {
            if (!user) {
              return res
                .status(401)
                .set("WWW-Authenticate", 'Bearer realm="api"')
                .json({ error: "invalid_token" });
            }
            req.user = user;
            next();
          })
          .catch(error => {
            logger.error("oauth.token.error", error);
            next(error);
          })
      : res
          .status(401)
          .set("WWW-Authenticate", 'Bearer realm="api"')
          .json({ error: "unauthorized_client" });
  };

export const clientPasswordOauth20Strategy = (
  allowedClientId: string,
  allowedClientSecret: string
) =>
  new ClientPasswordStrategy((clientId, clientSecret, done) =>
    done(
      null,
      allowedClientId === clientId && allowedClientSecret === clientSecret
        ? { id: clientId }
        : false
    )
  );

// Authenticates user-facing endpoints using Google OAuth 2.0
export const googleOauth20Strategy = (
  clientId: string,
  clientSecret: string,
  redirectUrl: string,
  verifyUser: (profile: Profile) => MaybeAsync<Maybe<User>>
) =>
  new GoogleOauth20Strategy(
    {
      clientID: clientId,
      clientSecret: clientSecret,
      callbackURL: redirectUrl,
      scope: ["email"],
      state: true,
    },
    async (accessToken, refreshToken, profile, callback) =>
      Promise.try(() => verifyUser(profile))
        .then(user => callback(null, user ?? false))
        .catch(error => callback(error))
  );

// Not a strategy but middleware to ensure user is logged in
export const requireLoggedIn = (
  request: Request,
  response: Response,
  next: NextFunction
) =>
  request.isAuthenticated()
    ? next()
    : response.status(401).json({ error: "Unauthorized" });

/**
 * Middleware to automatically log in a test user in non-production environments
 * when HOMED_USER_ID and HOMED_CLIENT_ID are set. This allows testing the UI
 * without going through the Google SSO flow.
 */
export const debugLoggedIn = (
  req: Request,
  _res: Response,
  next: NextFunction
) =>
  !req.isAuthenticated() &&
  process.env.NODE_ENV !== "production" &&
  process.env.HOMED_USER_ID &&
  process.env.HOMED_CLIENT_ID
    ? req.login(
        {
          id: process.env.HOMED_USER_ID as UserId,
          username: "Test user",
          clientToken: "empty" as ClientToken,
          createdAt: new Date(),
        },
        next
      )
    : next();

export const setSentryUser = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const user = req.user as User | undefined;
  if (user) {
    Sentry.setUser({ id: user.id, username: user.username });
  }
  next();
};
