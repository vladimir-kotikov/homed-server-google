import type { NextFunction, Request, Response } from "express";
import {
  Strategy as GoogleOauth20Strategy,
  type Profile,
} from "passport-google-oauth20";
import { ExtractJwt, Strategy as JwtStrategy } from "passport-jwt";
import type { User } from "../db/repository.ts";
import type { AccessTokenPayload } from "./oauth.ts";

declare type Maybe<T> = T | undefined;
declare type MaybeAsync<T> = T | Promise<T>;

// Authenticates Google Smarthome API endpoint with provided JWT token
export function jwtStrategy(
  jwtSecret: string,
  verifyUser: (token: AccessTokenPayload) => MaybeAsync<Maybe<User>>
) {
  return new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
    },
    async (payload: AccessTokenPayload, done) =>
      Promise.try(() => verifyUser(payload))
        // eslint-disable-next-line unicorn/no-null
        .then(user => done(null, user ?? false))
        .catch(error => done(error))
  );
}

// Authenticates user-facing endpoints using Google OAuth 2.0
export function googleOauth20Strategy(
  clientId: string,
  clientSecret: string,
  redirectUrl: string,
  verifyUser: (profile: Profile) => MaybeAsync<Maybe<User>>
) {
  return new GoogleOauth20Strategy(
    {
      clientID: clientId,
      clientSecret: clientSecret,
      callbackURL: redirectUrl,
    },
    async (accessToken, refreshToken, profile, callback) =>
      Promise.try(() => verifyUser(profile))
        // eslint-disable-next-line unicorn/no-null
        .then(user => callback(null, user ?? false))
        .catch(error => callback(error))
  );
}

// Not a strategy but middleware to ensure user is logged in
export const requireLoggedIn = (
  request: Request,
  response: Response,
  next: NextFunction
) =>
  request.isAuthenticated()
    ? next()
    : response.status(401).json({ error: "Unauthorized" });
