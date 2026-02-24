import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import crypto from "node:crypto";
import { createLogger } from "../logger.ts";
import * as schema from "./schema.ts";
import { users } from "./schema.ts";

const log = createLogger("user");

/**
 * Opaque token payload (AES-256-GCM encrypted, not visible to clients)
 */
interface OpaqueTokenPayload {
  typ: "code" | "access" | "refresh";
  sub: UserId;
  exp: number; // Unix timestamp seconds
}

const newClientToken = () =>
  crypto.randomBytes(32).toString("hex") as ClientToken;

export type ClientToken = string & { readonly __clientToken: unique symbol };
export type UserId = string & { readonly __userId: unique symbol };

export interface User {
  id: UserId;
  username: string;
  clientToken: ClientToken;
  linked: boolean | null;
  createdAt: Date;
}

type UserRepositoryOptions = {
  accessTokenLifetime?: number;
  refreshTokenLifetime?: number;
};

export class UserRepository {
  readonly database: Database.Database;
  private readonly client: BetterSQLite3Database<typeof schema>;
  private readonly encryptionKey: Buffer;
  private accessTokenLifetime: number;
  private refreshTokenLifetime: number;

  constructor(
    database: Database.Database,
    jwtSecret: string,
    options?: UserRepositoryOptions
  ) {
    this.database = database;
    this.client = drizzle(database, { schema });
    this.accessTokenLifetime = options?.accessTokenLifetime ?? 15 * 60; // 15 minutes
    this.refreshTokenLifetime =
      options?.refreshTokenLifetime ?? 7 * 24 * 60 * 60; // 7 days
    // Derive a 256-bit encryption key from the JWT secret using SHA-256.
    this.encryptionKey = crypto.createHash("sha256").update(jwtSecret).digest();
  }

  static open(
    databasePath: string = ":memory:",
    jwtSecret: string,
    {
      create = false,
      accessTokenLifetime,
      refreshTokenLifetime,
    }: { create: boolean } & Partial<UserRepositoryOptions>
  ): UserRepository {
    log.debug("database.open", { databasePath, create });
    const database = new Database(databasePath, { fileMustExist: !create });
    database.pragma("journal_mode = WAL");
    return new UserRepository(database, jwtSecret, {
      accessTokenLifetime,
      refreshTokenLifetime,
    });
  }

  close() {
    this.database.close();
  }

  /**
   * Decrypt and validate an opaque AES-256-GCM token.
   * Returns the UserId on success, or undefined if invalid/expired/wrong type.
   */
  private verifyToken = (
    token: string,
    expectedType: "code" | "access" | "refresh"
  ): UserId | undefined => {
    try {
      const buf = Buffer.from(token, "base64url");
      if (buf.length < 29) return undefined; // iv(12) + authTag(16) + 1 byte minimum
      const iv = buf.subarray(0, 12);
      const authTag = buf.subarray(12, 28);
      const encrypted = buf.subarray(28);
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.encryptionKey,
        iv
      );
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      const { typ, sub, exp } = JSON.parse(
        decrypted.toString("utf8")
      ) as OpaqueTokenPayload;
      if (typ !== expectedType || typeof sub !== "string") return undefined;
      if (
        typeof exp !== "number" ||
        isNaN(exp) ||
        exp < Math.floor(Date.now() / 1000)
      )
        return undefined;
      return sub;
    } catch {
      return undefined;
    }
  };

  /**
   * Encrypt a token payload with AES-256-GCM.
   * Returns a base64url-encoded string that is opaque to clients.
   * Format: base64url(iv[12] + authTag[16] + ciphertext)
   */
  issueToken = (
    typ: "code" | "access" | "refresh",
    expiresInSeconds: number,
    userId: UserId
  ): string => {
    const iv = crypto.randomBytes(12);
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload: OpaqueTokenPayload = { typ, sub: userId, exp };
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
  };

  issueCode = (userId: UserId) => this.issueToken("code", 5 * 60, userId);

  exchangeCode = async (code: string) => {
    const userId = this.verifyToken(code, "code");
    if (!userId) {
      log.warn("oauth.exchange_code.invalid_code");
      return undefined;
    }
    const user = await this.client.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) {
      log.warn("oauth.exchange_code.user_not_found", { userId });
      return undefined;
    }
    return [
      this.issueToken("access", this.accessTokenLifetime, user.id),
      this.issueToken("refresh", this.refreshTokenLifetime, user.id),
    ];
  };

  exchangeRefreshToken = async (token: string) => {
    const userId = this.verifyToken(token, "refresh");
    if (!userId) return undefined;
    const user = await this.client.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) return undefined;
    return [
      this.issueToken("access", this.accessTokenLifetime, user.id),
      this.issueToken("refresh", this.refreshTokenLifetime, user.id),
    ];
  };

  /**
   * Verify an opaque access token and return the corresponding user.
   * Used by the Bearer authentication middleware.
   */
  verifyAccessToken = async (rawToken: string): Promise<User | undefined> => {
    const userId = this.verifyToken(rawToken, "access");
    if (!userId) return undefined;
    return this.client.query.users.findFirst({
      where: eq(users.id, userId),
    });
  };

  getOrCreate = (id: UserId, username: string): Promise<User> =>
    this.client
      .insert(users)
      .values({ id, username, clientToken: newClientToken() })
      .onConflictDoNothing()
      .returning()
      .then(result =>
        result.length > 0
          ? result[0]
          : (this.client.query.users.findFirst({
              where: eq(users.id, id as UserId),
            }) as Promise<User>)
      );

  getByToken = (token: ClientToken) =>
    this.client.query.users.findFirst({
      where: eq(users.clientToken, token),
    });

  isUserLinked = (id: UserId): Promise<boolean> =>
    this.client.query.users
      .findFirst({ where: eq(users.id, id) })
      .then(user => user?.linked ?? false);

  setLinked = async (id: UserId, linked: boolean) =>
    this.client.update(users).set({ linked }).where(eq(users.id, id)).run();

  delete = async (id: UserId) =>
    this.client.delete(users).where(eq(users.id, id)).run();
}
