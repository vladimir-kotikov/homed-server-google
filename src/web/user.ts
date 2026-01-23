import type { Request, Response } from "express";
import { Router } from "express";
import type { Session } from "express-session";
import { OAuth2Client } from "google-auth-library";
import * as crypto from "node:crypto";
import { AuthService } from "../services/auth.service.ts";

const authService = new AuthService();

// Type for request with session
type RequestWithSession = Request & {
  session?: Session & { userId?: string };
};

// Type for session destroy callback
interface SessionError extends Error {
  message: string;
}

// function this.googleOAuthClient: OAuth2Client {
//   if (!googleOAuthClient) {
//     const clientId = process.env.GOOGLE_USER_CLIENT_ID;
//     const clientSecret = process.env.GOOGLE_USER_CLIENT_SECRET;
//     const redirectUri = process.env.GOOGLE_USER_REDIRECT_URI;

//     if (!clientId || !clientSecret || !redirectUri) {
//       throw new Error(
//         "Google OAuth credentials not configured. " +
//           "Please set GOOGLE_USER_CLIENT_ID, GOOGLE_USER_CLIENT_SECRET, and GOOGLE_USER_REDIRECT_URI"
//       );
//     }

//     googleOAuthClient = new OAuth2Client(clientId, clientSecret, redirectUri);
//   }
//   return googleOAuthClient;
// }

export class UserController {
  googleOAuthClient: OAuth2Client;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.googleOAuthClient = new OAuth2Client(
      clientId,
      clientSecret,
      redirectUri
    );
  }
  /**
   * GET /
   * Display login/register page or dashboard if authenticated
   */
  async home(request: RequestWithSession, response: Response): Promise<void> {
    const userId = request.session?.userId;

    if (userId) {
      // User is logged in, show dashboard
      const user = await authService.getUserById(userId);
      if (user) {
        return this.renderDashboard(response, user.username, user.clientToken);
      }
    }

    // Show Google Sign-In page
    this.renderGoogleSignIn(response);
  }

  /**
   * GET /auth/google
   * Initiate Google OAuth flow
   */
  async googleAuth(request: Request, response: Response): Promise<void> {
    const authUrl = this.googleOAuthClient.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
    });
    response.redirect(authUrl);
  }

  /**
   * GET /auth/google/callback
   * Handle Google OAuth callback
   */
  async googleCallback(
    request: RequestWithSession,
    response: Response
  ): Promise<void> {
    const { code } = request.query;

    if (!code || typeof code !== "string") {
      response.status(400).send("Missing authorization code");
      return;
    }

    try {
      const client = this.googleOAuthClient;
      // Exchange code for tokens
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Get user info
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_USER_CLIENT_ID,
      });
      const payload = ticket.getPayload();

      if (!payload || !payload.email) {
        response.status(400).send("Failed to get user information");
        return;
      }

      // Find or create user by email
      let user = await authService.getUserByUsername(payload.email);
      if (!user) {
        user = await authService.createUser(
          payload.email,
          crypto.randomBytes(32).toString("hex")
        );
      }

      if (request.session) {
        request.session.userId = user.id;
      }

      // Redirect to home page
      response.redirect("/");
    } catch (error) {
      console.error("Google OAuth error:", error);
      response.status(500).send("Authentication failed");
    }
  }

  /**
   * POST /auth/login
   * Process login credentials
   */
  async login(request: RequestWithSession, response: Response): Promise<void> {
    const { username, password } = request.body;

    if (!username || !password) {
      response.status(400).json({
        error: "Missing username or password",
      });
      return;
    }

    const user = await authService.validateUserCredentials(username, password);
    if (!user) {
      response.status(401).json({
        error: "Invalid username or password",
      });
      return;
    }

    if (request.session) {
      request.session.userId = user.id;
    }

    response.json({
      success: true,
      username: user.username,
      clientToken: user.clientToken,
    });
  }

  /**
   * POST /auth/logout
   * Logout user
   */
  async logout(request: RequestWithSession, response: Response): Promise<void> {
    request.session?.destroy((error: SessionError | null) => {
      if (error) {
        response.status(500).json({ error: "Failed to logout" });
      } else {
        response.json({ success: true });
      }
    });
  }

  /**
   * Render Google Sign-In page
   */
  private renderGoogleSignIn(response: Response): void {
    const isTest = process.env.NODE_ENV === "test";
    response.render("signin", { isTest });
  }

  /**
   * Render dashboard with client token
   */
  private renderDashboard(
    response: Response,
    username: string,
    clientToken: string
  ): void {
    const tcpPort = process.env.TCP_PORT || "8042";
    response.render("dashboard", { username, clientToken, tcpPort });
  }

  get routes() {
    return (
      Router()
        // Home/Dashboard
        .get("/", (request, response) => this.home(request, response))
        // Google OAuth routes
        .get("/auth/google", (request, response) =>
          this.googleAuth(request, response)
        )
        .get("/auth/google/callback", (request, response) =>
          this.googleCallback(request, response)
        )
        // Auth routes (legacy - can be removed if not needed)
        .post("/auth/login", (request, response) =>
          this.login(request, response)
        )
        .post("/auth/logout", (request, response) =>
          this.logout(request, response)
        )
    );
  }
}
