import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import * as crypto from "node:crypto";
import * as schema from "./schema.ts";
import { authCodes, refreshTokens, users } from "./schema.ts";

export interface User {
  id: string;
  username: string;
  clientToken: string;
  createdAt: Date;
}

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

export interface RefreshToken {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export class UserRepository {
  private db: Database.Database;
  private client: BetterSQLite3Database<typeof schema>;

  constructor(database: Database.Database) {
    this.db = database;
    this.client = drizzle(database, { schema });
  }

  static open(
    databasePath: string = ":memory:",
    { create = false }: { create: boolean }
  ): UserRepository {
    console.log(
      `Opening database at ${databasePath} (create: ${create ? "yes" : "no"})`
    );
    const database = new Database(databasePath, { fileMustExist: !create });
    database.pragma("journal_mode = WAL");
    return new UserRepository(database);
  }

  close() {
    this.db.close();
  }

  /**
   * Find user by client token with timing-safe comparison
   */
  async findByClientToken(token: string): Promise<User | undefined> {
    try {
      const user = await this.client.query.users.findFirst({
        where: eq(schema.users.clientToken, token),
      });

      if (!user) {
        return;
      }

      // Use constant-time comparison to prevent timing attacks
      const tokenBuffer = Buffer.from(token);
      const storedBuffer = Buffer.from(user.clientToken);

      if (tokenBuffer.length !== storedBuffer.length) {
        return;
      }

      if (!crypto.timingSafeEqual(tokenBuffer, storedBuffer)) {
        return;
      }

      return user;
    } catch (error) {
      console.error("Error finding user by client token:", error);
      return;
    }
  }

  /**
   * Find user by username
   */
  async findByUsername(username: string): Promise<User | undefined> {
    try {
      const user = await this.client.query.users.findFirst({
        where: eq(users.username, username),
      });
      return user;
    } catch (error) {
      console.error("Error finding user by username:", error);
      return;
    }
  }

  /**
   * Find user by ID
   */
  getUser = (userId: string): Promise<User | undefined> =>
    this.client.query.users.findFirst({
      where: eq(users.id, userId),
    });

  /**
   * Create a new user
   */
  createUser = (
    id: string,
    username: string,
    clientToken?: string
  ): Promise<User> =>
    this.client
      .insert(users)
      .values({
        id,
        username,
        clientToken: clientToken ?? crypto.randomBytes(32).toString("hex"),
      })
      .returning()
      .then(result => result[0]);

  getOrCreateUser = async (userId: string): Promise<User> =>
    this.getUser(userId).then(user => user ?? this.createUser(userId));

  /**
   * Create an authorization code for OAuth flow
   */
  async createCode(
    userId: string,
    clientId: string,
    redirectUri: string
  ): Promise<string> {
    const code = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    try {
      await this.client.insert(authCodes).values({
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
  async getCode(code: string): Promise<AuthCode | undefined> {
    try {
      const authCode = await this.client.query.authCodes.findFirst({
        where: eq(authCodes.code, code),
      });
      return authCode;
    } catch (error) {
      console.error("Error finding auth code:", error);
      return;
    }
  }

  /**
   * Delete an authorization code (one-time use)
   */
  async deleteCode(code: string): Promise<void> {
    try {
      await this.client.delete(authCodes).where(eq(authCodes.code, code));
    } catch (error) {
      console.error("Error deleting auth code:", error);
      throw new Error("Failed to delete auth code");
    }
  }

  async createRefreshToken(
    userId: string,
    expiresAt: Date
  ): Promise<RefreshToken> {
    try {
      const token = crypto.randomBytes(32).toString("hex");

      const result = await this.client
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
  async getRefreshToken(tokenId: string): Promise<RefreshToken | undefined> {
    try {
      const token = await this.client.query.refreshTokens.findFirst({
        where: eq(refreshTokens.id, tokenId),
      });
      return token;
    } catch (error) {
      console.error("Error finding refresh token by ID:", error);
      return;
    }
  }

  /**
   * Delete a refresh token (revoke)
   */
  async deleteToken(tokenId: string): Promise<void> {
    try {
      await this.client
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
  async revokeTokens(userId: string): Promise<void> {
    try {
      await this.client
        .delete(refreshTokens)
        .where(eq(refreshTokens.userId, userId));
    } catch (error) {
      console.error("Error deleting refresh tokens for user:", error);
      throw new Error("Failed to delete refresh tokens");
    }
  }
}
