/* eslint-disable unicorn/no-null */
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  Strategy as GoogleOauth20Strategy,
  type Profile,
} from "passport-google-oauth20";
import { ExtractJwt, Strategy as JwtStrategy } from "passport-jwt";
import { Strategy as ClientPasswordStrategy } from "passport-oauth2-client-password";
import {
  JWT_ALGORITHM,
  type ClientToken,
  type User,
  type UserId,
} from "../db/repository.ts";

declare type Maybe<T> = T | undefined;
declare type MaybeAsync<T> = T | Promise<T>;

// Authenticates Google Smarthome API endpoint with provided JWT token
export const jwtStrategy = (
  jwtSecret: string,
  verifyToken: (token: jwt.JwtPayload) => MaybeAsync<Maybe<User>>
) =>
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
      algorithms: [JWT_ALGORITHM],
    },
    async (payload, done) =>
      Promise.try(() => verifyToken(payload))
        .then(user => done(null, user ?? false))
        .catch(error => done(error))
  );

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
