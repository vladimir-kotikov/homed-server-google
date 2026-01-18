import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDrizzle } from "../index.ts";
import { refreshTokens } from "../schema.ts";

export interface RefreshToken {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export class RefreshTokenRepository {
  /**
   * Create a refresh token record
   */
  async create(userId: string, expiresAt: Date): Promise<RefreshToken> {
    try {
      const token = crypto.randomBytes(32).toString("hex");

      const result = await getDrizzle()
        .insert(refreshTokens)
        .values({
          id: crypto.randomUUID(),
          userId,
          token,
          expiresAt,
        })
        .returning();

      return result[0];
    } catch (error) {
      console.error("Error creating refresh token:", error);
      throw new Error("Failed to create refresh token");
    }
  }

  /**
   * Find refresh token by ID
   */
  async findById(tokenId: string): Promise<RefreshToken | null> {
    try {
      const token = await getDrizzle().query.refreshTokens.findFirst({
        where: eq(refreshTokens.id, tokenId),
      });
      return token ?? null;
    } catch (error) {
      console.error("Error finding refresh token by ID:", error);
      return null;
    }
  }

  /**
   * Delete a refresh token (revoke)
   */
  async delete(tokenId: string): Promise<void> {
    try {
      await getDrizzle()
        .delete(refreshTokens)
        .where(eq(refreshTokens.id, tokenId));
    } catch (error) {
      console.error("Error deleting refresh token:", error);
      // Ignore if token doesn't exist
    }
  }

  /**
   * Delete all refresh tokens for a user (revoke all)
   */
  async deleteByUserId(userId: string): Promise<void> {
    try {
      await getDrizzle()
        .delete(refreshTokens)
        .where(eq(refreshTokens.userId, userId));
    } catch (error) {
      console.error("Error deleting refresh tokens for user:", error);
      throw new Error("Failed to delete refresh tokens");
    }
  }
}
