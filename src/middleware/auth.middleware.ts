import { NextFunction, Request, Response } from "express";
import { TokenService } from "../services/token.service";

const tokenService = new TokenService();

/**
 * Extend Express Request type to include user info
 */
export interface AuthenticatedRequest extends Request {
  userId?: string;
}

/**
 * Middleware to authenticate JWT access token from Authorization header
 */
export function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;

  if (!token) {
    res
      .status(401)
      .json({ error: "unauthorized", error_description: "No token provided" });
    return;
  }

  const payload = tokenService.verifyAccessToken(token);

  if (!payload) {
    res.status(401).json({
      error: "invalid_token",
      error_description: "Token is invalid or expired",
    });
    return;
  }

  req.userId = payload.userId;
  next();
}

/**
 * Middleware to validate OAuth request parameters
 */
export function validateOAuthRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { client_id, redirect_uri, response_type, state } = req.query;

  // Validate required parameters
  if (!client_id) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "client_id is required",
    });
    return;
  }

  if (!redirect_uri) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri is required",
    });
    return;
  }

  if (response_type !== "code") {
    res.status(400).json({
      error: "unsupported_response_type",
      error_description: "Only code response type is supported",
    });
    return;
  }

  // Validate client_id matches configured OAuth client
  const configuredClientId = process.env.OAUTH_CLIENT_ID;
  if (client_id !== configuredClientId) {
    res.status(400).json({
      error: "invalid_client",
      error_description: "Invalid client_id",
    });
    return;
  }

  // Store OAuth params in request for controller
  req.body.oauthParams = {
    clientId: client_id as string,
    redirectUri: redirect_uri as string,
    state: state as string | undefined,
  };

  next();
}
