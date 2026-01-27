/* eslint-disable @typescript-eslint/no-namespace */
import { ensureLoggedIn, ensureLoggedOut } from "connect-ensure-login";
import { Router, type Request, type Response } from "express";
import "express-session";
import passport from "passport";
import type { User as HomedUser } from "../db/repository.ts";

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

const home = (request: Request, response: Response) => {
  const {
    user: { id, clientToken },
  } = request as Express.AuthenticatedRequest;
  response.render("dashboard", { username: id, clientToken });
};

const login = (_request: Request, response: Response) =>
  response.render("signin", {
    isTest: process.env.NODE_ENV === "test",
  });

const logout = (request: Request, response: Response) =>
  request.session.destroy(() => response.redirect("/"));

export default Router()
  .get("/", ensureLoggedIn("/login"), home)
  .get("/login", ensureLoggedOut("/"), login)
  .get(
    "/auth/google",
    passport.authenticate("google-oauth20", { scope: ["profile", "email"] })
  )
  .get(
    "/auth/google/callback",
    passport.authenticate("google-oauth20", { keepSessionInfo: true }),
    (request, response) => {
      const redirectUrl = request.session.returnTo ?? "/";
      delete request.session.returnTo;
      response.redirect(redirectUrl);
    }
  )
  .get("/logout", logout);
