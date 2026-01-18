import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDrizzle } from "../index.ts";
import { authCodes } from "../schema.ts";

export interface AuthCode {
  id: string;
  code: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export class AuthCodeRepository {
  /**
   * Create an authorization code for OAuth flow
   */
  async create(
    userId: string,
    clientId: string,
    redirectUri: string
  ): Promise<string> {
    const code = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    try {
      await getDrizzle().insert(authCodes).values({
        id: crypto.randomUUID(),
        code,
        userId,
        clientId,
        redirectUri,
        expiresAt,
      });

      return code;
    } catch (error) {
      console.error("Error creating auth code:", error);
      throw new Error("Failed to create auth code");
    }
  }

  /**
   * Find and validate authorization code
   */
  async findByCode(code: string): Promise<AuthCode | null> {
    try {
      const authCode = await getDrizzle().query.authCodes.findFirst({
        where: eq(authCodes.code, code),
      });
      return authCode ?? null;
    } catch (error) {
      console.error("Error finding auth code:", error);
      return null;
    }
  }

  /**
   * Delete an authorization code (one-time use)
   */
  async delete(code: string): Promise<void> {
    try {
      await getDrizzle().delete(authCodes).where(eq(authCodes.code, code));
    } catch (error) {
      console.error("Error deleting auth code:", error);
      throw new Error("Failed to delete auth code");
    }
  }
}
