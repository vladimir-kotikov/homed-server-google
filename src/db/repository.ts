import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import * as crypto from "node:crypto";
import * as schema from "./schema.ts";
import { authCodes, refreshTokens, users } from "./schema.ts";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
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

function createTables(database: Database.Database) {
  // Create tables if they don't exist
  database.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      client_token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_code (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id)
    );

    CREATE TABLE IF NOT EXISTS refresh_token (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user(id)
    );

    CREATE INDEX IF NOT EXISTS idx_auth_code_code ON auth_code(code);
    CREATE INDEX IF NOT EXISTS idx_auth_code_user_id ON auth_code(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_token_token ON refresh_token(token);
    CREATE INDEX IF NOT EXISTS idx_refresh_token_user_id ON refresh_token(user_id);
  `);
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
    const database = new Database(databasePath);
    database.pragma("journal_mode = WAL");

    if (create) {
      createTables(database);
    }

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
  async getUser(userId: string): Promise<User | undefined> {
    try {
      const user = await this.client.query.users.findFirst({
        where: eq(users.id, userId),
      });
      return user;
    } catch (error) {
      console.error("Error finding user by ID:", error);
      return;
    }
  }

  /**
   * Create a new user
   */
  async createUser(
    username: string,
    passwordHash: string,
    clientToken: string
  ): Promise<User> {
    try {
      const result = await this.client
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          username,
          passwordHash,
          clientToken,
        })
        .returning();

      return result[0];
    } catch (error) {
      console.error("Error creating user:", error);
      throw new Error("Failed to create user");
    }
  }

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

  async createToken(userId: string, expiresAt: Date): Promise<RefreshToken> {
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
