import { ensureLoggedIn, ensureLoggedOut } from "connect-ensure-login";
import { Router, type Request, type Response } from "express";
import passport from "passport";
import type { User as HomedUser } from "../db/repository.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends HomedUser {}
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

/**
 * POST /auth/logout
 * Logout user
 */
const logout = (request: Request, response: Response) => {
  request.session.destroy(() => {});
  response.json({ success: true });
};

export default Router()
  .get("/", ensureLoggedIn("/login"), home)
  .get("/login", ensureLoggedOut("/"), login)
  .get(
    "/auth/google",
    passport.authenticate("google-oauth20", { scope: ["profile", "email"] })
  )
  .get(
    "/auth/google/callback",
    passport.authenticate("google-oauth20"),
    (request, response) => response.redirect("/")
  )
  .post("/logout", logout);
