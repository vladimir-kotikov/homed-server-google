import jwt from "jsonwebtoken";
import {
  AuthCodeRepository,
  RefreshTokenRepository,
} from "../db/repositories/index.ts";

export interface AccessTokenPayload {
  userId: string;
  type: "access";
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
  type: "refresh";
}

export class TokenService {
  private jwtSecret: string;
  private accessExpiresIn: string;
  private refreshExpiresIn: string;
  private authCodeRepository: AuthCodeRepository;
  private refreshTokenRepository: RefreshTokenRepository;

  constructor(
    jwtSecret: string = process.env.JWT_SECRET || "default-secret",
    accessExpiresIn: string = process.env.JWT_ACCESS_EXPIRES_IN || "1h",
    refreshExpiresIn: string = process.env.JWT_REFRESH_EXPIRES_IN || "30d"
  ) {
    this.jwtSecret = jwtSecret;
    this.accessExpiresIn = accessExpiresIn;
    this.refreshExpiresIn = refreshExpiresIn;
    this.authCodeRepository = new AuthCodeRepository();
    this.refreshTokenRepository = new RefreshTokenRepository();
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
    const refreshTokenRecord = await this.refreshTokenRepository.create(
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
  verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as AccessTokenPayload;
      if (decoded.type !== "access") {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Verify and decode JWT refresh token
   */
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as RefreshTokenPayload;
      if (decoded.type !== "refresh") {
        return null;
      }

      // Check if token still exists in database (not revoked)
      const refreshTokenRecord = await this.refreshTokenRepository.findById(
        decoded.tokenId
      );

      if (!refreshTokenRecord || refreshTokenRecord.userId !== decoded.userId) {
        return null;
      }

      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Create authorization code for OAuth flow
   */
  async createAuthCode(
    userId: string,
    clientId: string,
    redirectUri: string
  ): Promise<string> {
    return this.authCodeRepository.create(userId, clientId, redirectUri);
  }

  /**
   * Validate and consume authorization code
   */
  async validateAuthCode(
    code: string,
    clientId: string,
    redirectUri: string
  ): Promise<string | null> {
    const authCode = await this.authCodeRepository.findByCode(code);

    if (!authCode) {
      return null;
    }

    // Check if code expired
    if (authCode.expiresAt < new Date()) {
      await this.authCodeRepository.delete(code);
      return null;
    }

    // Validate client ID and redirect URI
    if (
      authCode.clientId !== clientId ||
      authCode.redirectUri !== redirectUri
    ) {
      return null;
    }

    // Delete code (one-time use)
    await this.authCodeRepository.delete(code);

    return authCode.userId;
  }

  /**
   * Revoke refresh token (for logout/disconnect)
   */
  async revokeRefreshToken(tokenId: string): Promise<void> {
    await this.refreshTokenRepository.delete(tokenId);
  }

  /**
   * Revoke all refresh tokens for a user (for account unlinking)
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository.deleteByUserId(userId);
  }
}
