import { Router } from "express";

import type { Request, Response } from "express";

import jwt from "jsonwebtoken";
import { UserRepository } from "../db/repository.ts";

export interface AccessTokenPayload {
  userId: string;
  type: "access";
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
  type: "refresh";
}

export class OAuthController {
  private jwtSecret: string;
  private accessExpiresIn: string;
  private refreshExpiresIn: string;
  private userRepository: UserRepository;
  verifyClientCredentials: (clientId: string, clientSecret: string) => boolean;

  constructor(
    userRepository: UserRepository,
    jwtSecret: string,
    verifyClientCredentials: (
      clientId: string,
      clientSecret: string
    ) => boolean,
    accessExpiresIn: string = "1h",
    refreshExpiresIn: string = "30d"
  ) {
    this.userRepository = userRepository;
    this.jwtSecret = jwtSecret;
    this.accessExpiresIn = accessExpiresIn;
    this.refreshExpiresIn = refreshExpiresIn;
    this.verifyClientCredentials = verifyClientCredentials;
  }

  /**
   * Generate JWT access token for a user
   */
  generateAccessToken(userId: string): string {
    const payload: AccessTokenPayload = {
      userId,
      type: "access",
    };
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.accessExpiresIn,
    } as jwt.SignOptions);
  }

  /**
   * Generate JWT refresh token and store in database
   */
  async generateRefreshToken(userId: string): Promise<string> {
    // Calculate expiration (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Create refresh token record in database
    const refreshTokenRecord = await this.userRepository.createToken(
      userId,
      expiresAt
    );

    // Create JWT with token ID
    const payload: RefreshTokenPayload = {
      userId,
      tokenId: refreshTokenRecord.id,
      type: "refresh",
    };
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.refreshExpiresIn,
    } as jwt.SignOptions);
  }

  /**
   * Verify and decode JWT access token
   */
  verifyAccessToken(token: string): AccessTokenPayload | undefined {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as AccessTokenPayload;
      if (decoded.type !== "access") {
        return undefined;
      }
      return decoded;
    } catch {
      return undefined;
    }
  }

  /**
   * Verify and decode JWT refresh token
   */
  async verifyRefreshToken(
    token: string
  ): Promise<RefreshTokenPayload | undefined> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as RefreshTokenPayload;
      if (decoded.type !== "refresh") {
        return undefined;
      }

      // Check if token still exists in database (not revoked)
      const refreshTokenRecord = await this.userRepository.getRefreshToken(
        decoded.tokenId
      );

      if (!refreshTokenRecord || refreshTokenRecord.userId !== decoded.userId) {
        return undefined;
      }

      return decoded;
    } catch {
      return undefined;
    }
  }

  /**
   * Validate and consume authorization code
   */
  async validateAuthCode(
    code: string,
    clientId: string,
    redirectUri: string
  ): Promise<string | undefined> {
    const authCode = await this.userRepository.getCode(code);

    if (!authCode) {
      return undefined;
    }

    // Check if code expired
    if (authCode.expiresAt < new Date()) {
      await this.userRepository.deleteCode(code);
      return undefined;
    }

    // Validate client ID and redirect URI
    if (
      authCode.clientId !== clientId ||
      authCode.redirectUri !== redirectUri
    ) {
      return undefined;
    }

    // Delete code (one-time use)
    await this.userRepository.deleteCode(code);

    return authCode.userId;
  }

  /**
   * Revoke all refresh tokens for a user (for account unlinking)
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.userRepository.revokeTokens(userId);
  }

  /**
   * GET /oauth/authorize
   * Display login page with OAuth parameters
   */
  async authorize(request: Request, response: Response): Promise<void> {
    const { client_id, client_secret, redirect_uri, response_type } =
      request.query;

    // Validate required parameters
    if (!client_id || !redirect_uri) {
      response.status(400).json({
        error: "invalid_request",
        error_description: "Missing required parameters",
      });
      return;
    }

    if (response_type !== "code") {
      response.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only authorization code flow is supported",
      });
      return;
    }

    // Validate client_id
    if (!this.verifyClientCredentials(client_id, client_secret)) {
      response.status(400).json({
        error: "invalid_client",
        error_description: "Unknown client",
      });
      return;
    }

    // Redirect to static login page with query parameters preserved
    response.redirect(`/login.html?${request.url.split("?")[1] || ""}`);
  }

  /**
   * POST /oauth/authorize
   * Process login credentials and generate authorization code
   */
  async authorizePost(request: Request, response: Response): Promise<void> {
    const { username, password, client_id, redirect_uri, state } = request.body;

    // Validate required parameters
    if (!username || !password) {
      response.status(401).json({
        error: "invalid_request",
        error_description: "Missing username or password",
      });
      return;
    }

    if (!client_id || !redirect_uri) {
      response.status(400).json({
        error: "invalid_request",
        error_description: "Missing OAuth parameters",
      });
      return;
    }

    // Validate client_id
    const configuredClientId = process.env.OAUTH_CLIENT_ID;
    if (client_id !== configuredClientId) {
      response.status(400).json({
        error: "invalid_client",
        error_description: "Unknown client",
      });
      return;
    }

    // Authenticate user
    const user = await this.authService.validateUserCredentials(
      username,
      password
    );
    if (!user) {
      response.status(401).json({
        error: "invalid_grant",
        error_description: "Invalid username or password",
      });
      return;
    }

    // Generate authorization code
    const code = await this.userRepository.createCode(
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

    response.json({
      redirect_uri: redirectUrl.toString(),
    });
  }

  /**
   * POST /oauth/token
   * Exchange authorization code or refresh token for access token
   */
  async token(request: Request, response: Response): Promise<void> {
    const {
      grant_type,
      code,
      refresh_token,
      client_id,
      client_secret,
      redirect_uri,
    } = request.body;

    // Validate client credentials
    const configuredClientId = process.env.OAUTH_CLIENT_ID;
    const configuredClientSecret = process.env.OAUTH_CLIENT_SECRET;

    if (
      client_id !== configuredClientId ||
      client_secret !== configuredClientSecret
    ) {
      response.status(401).json({
        error: "invalid_client",
        error_description: "Invalid client credentials",
      });
      return;
    }

    if (grant_type === "authorization_code") {
      // Exchange authorization code for tokens
      if (!code || !redirect_uri) {
        response.status(400).json({
          error: "invalid_request",
          error_description: "Missing code or redirect_uri",
        });
        return;
      }

      const userId = await this.validateAuthCode(code, client_id, redirect_uri);
      if (!userId) {
        response.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired authorization code",
        });
        return;
      }

      // Generate tokens
      const accessToken = this.generateAccessToken(userId);
      const refreshToken = await this.generateRefreshToken(userId);

      response.json({
        token_type: "Bearer",
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600, // 1 hour
      });
    } else if (grant_type === "refresh_token") {
      // Refresh access token
      if (!refresh_token) {
        response.status(400).json({
          error: "invalid_request",
          error_description: "Missing refresh_token",
        });
        return;
      }

      const payload = await this.verifyRefreshToken(refresh_token);
      if (!payload) {
        response.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired refresh token",
        });
        return;
      }

      // Generate new access token
      const accessToken = this.generateAccessToken(payload.userId);

      response.json({
        token_type: "Bearer",
        access_token: accessToken,
        expires_in: 3600,
      });
    } else {
      response.status(400).json({
        error: "unsupported_grant_type",
        error_description:
          "Only authorization_code and refresh_token grant types are supported",
      });
    }
  }

  get routes() {
    return (
      Router()
        // GET /oauth/authorize - Display login page
        .get("/authorize", (request, response) =>
          this.authorize(request, response)
        )
        // POST /oauth/authorize - Process login and generate auth code
        .post("/authorize", (request, response) =>
          this.authorizePost(request, response)
        )
        // POST /oauth/token - Exchange auth code or refresh token for access token
        .post("/token", (request, response) => this.token(request, response))
    );
  }
}
