import type { Request, Response } from "express";
import { AuthService } from "../services/auth.service.ts";
import { TokenService } from "../services/token.service.ts";

const tokenService = new TokenService();
const authService = new AuthService();

export class OAuthController {
  /**
   * GET /oauth/authorize
   * Display login page with OAuth parameters
   */
  async authorize(req: Request, res: Response): Promise<void> {
    const { client_id, redirect_uri, response_type } = req.query;

    // Validate required parameters
    if (!client_id || !redirect_uri) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required parameters",
      });
      return;
    }

    if (response_type !== "code") {
      res.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only authorization code flow is supported",
      });
      return;
    }

    // Validate client_id
    const configuredClientId = process.env.OAUTH_CLIENT_ID;
    if (client_id !== configuredClientId) {
      res.status(400).json({
        error: "invalid_client",
        error_description: "Unknown client",
      });
      return;
    }

    // Redirect to static login page with query parameters preserved
    res.redirect(`/login.html?${req.url.split("?")[1] || ""}`);
  }

  /**
   * POST /oauth/authorize
   * Process login credentials and generate authorization code
   */
  async authorizePost(req: Request, res: Response): Promise<void> {
    const { username, password, client_id, redirect_uri, state } = req.body;

    // Validate required parameters
    if (!username || !password) {
      res.status(401).json({
        error: "invalid_request",
        error_description: "Missing username or password",
      });
      return;
    }

    if (!client_id || !redirect_uri) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing OAuth parameters",
      });
      return;
    }

    // Validate client_id
    const configuredClientId = process.env.OAUTH_CLIENT_ID;
    if (client_id !== configuredClientId) {
      res.status(400).json({
        error: "invalid_client",
        error_description: "Unknown client",
      });
      return;
    }

    // Authenticate user
    const user = await authService.validateUserCredentials(username, password);
    if (!user) {
      res.status(401).json({
        error: "invalid_grant",
        error_description: "Invalid username or password",
      });
      return;
    }

    // Generate authorization code
    const code = await tokenService.createAuthCode(
      user.id,
      client_id,
      redirect_uri
    );

    // Build redirect URL
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    res.json({
      redirect_uri: redirectUrl.toString(),
    });
  }

  /**
   * POST /oauth/token
   * Exchange authorization code or refresh token for access token
   */
  async token(req: Request, res: Response): Promise<void> {
    const {
      grant_type,
      code,
      refresh_token,
      client_id,
      client_secret,
      redirect_uri,
    } = req.body;

    // Validate client credentials
    const configuredClientId = process.env.OAUTH_CLIENT_ID;
    const configuredClientSecret = process.env.OAUTH_CLIENT_SECRET;

    if (
      client_id !== configuredClientId ||
      client_secret !== configuredClientSecret
    ) {
      res.status(401).json({
        error: "invalid_client",
        error_description: "Invalid client credentials",
      });
      return;
    }

    if (grant_type === "authorization_code") {
      // Exchange authorization code for tokens
      if (!code || !redirect_uri) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing code or redirect_uri",
        });
        return;
      }

      const userId = await tokenService.validateAuthCode(
        code,
        client_id,
        redirect_uri
      );
      if (!userId) {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired authorization code",
        });
        return;
      }

      // Generate tokens
      const accessToken = tokenService.generateAccessToken(userId);
      const refreshToken = await tokenService.generateRefreshToken(userId);

      res.json({
        token_type: "Bearer",
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600, // 1 hour
      });
    } else if (grant_type === "refresh_token") {
      // Refresh access token
      if (!refresh_token) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing refresh_token",
        });
        return;
      }

      const payload = await tokenService.verifyRefreshToken(refresh_token);
      if (!payload) {
        res.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired refresh token",
        });
        return;
      }

      // Generate new access token
      const accessToken = tokenService.generateAccessToken(payload.userId);

      res.json({
        token_type: "Bearer",
        access_token: accessToken,
        expires_in: 3600,
      });
    } else {
      res.status(400).json({
        error: "unsupported_grant_type",
        error_description:
          "Only authorization_code and refresh_token grant types are supported",
      });
    }
  }
}
