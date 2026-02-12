import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { createLogger } from "../logger.ts";
import * as schema from "./schema.ts";
import { users } from "./schema.ts";

const log = createLogger("user");

export const JWT_ALGORITHM = "HS256" as const;

const newClientToken = () =>
  crypto.randomBytes(32).toString("hex") as ClientToken;

export type ClientToken = string & { readonly __clientToken: unique symbol };
export type UserId = string & { readonly __userId: unique symbol };

export interface User {
  id: UserId;
  username: string;
  clientToken: ClientToken;
  createdAt: Date;
}

type UserRepositoryOptions = {
  accessTokenLifetime?: number;
  refreshTokenLifetime?: number;
};

export class UserRepository {
  readonly database: Database.Database;
  private readonly client: BetterSQLite3Database<typeof schema>;
  private readonly jwtSecret: string;
  private accessTokenLifetime: number;
  private refreshTokenLifetime: number;

  constructor(
    database: Database.Database,
    jwtSecret: string,
    options?: UserRepositoryOptions
  ) {
    this.database = database;
    this.client = drizzle(database, { schema });
    this.jwtSecret = jwtSecret;
    this.accessTokenLifetime = options?.accessTokenLifetime ?? 15 * 60; // 15 minutes
    this.refreshTokenLifetime =
      options?.refreshTokenLifetime ?? 7 * 24 * 60 * 60; // 7 days
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

  private verifyTokenPayload = (
    { typ, sub }: jwt.JwtPayload,
    expectedType: string
  ) => {
    if (typ !== expectedType || !sub) {
      return;
    }

    return this.client.query.users.findFirst({
      where: eq(users.id, sub as UserId),
    });
  };

  private verifyToken = async (
    token: string,
    expectedType: string,
    clientId?: string,
    redirectUri?: string
  ) => {
    const options = { algorithms: [JWT_ALGORITHM] } as jwt.VerifyOptions;
    if (clientId) {
      options.issuer = clientId;
    }
    if (redirectUri) {
      options.audience = redirectUri;
    }
    try {
      const payload = jwt.verify(
        token,
        this.jwtSecret,
        options
      ) as jwt.JwtPayload;
      return this.verifyTokenPayload(payload, expectedType);
    } catch {
      return;
    }
  };

  // This can be made private and is public only for testing purposes
  issueToken = (
    typ: "code" | "access" | "refresh",
    expiresIn: string | number,
    userId: UserId,
    clientId?: string,
    redirectUri?: string
  ) => {
    const options = {
      subject: userId,
      expiresIn,
      algorithm: JWT_ALGORITHM,
    } as jwt.SignOptions;
    if (clientId) {
      options.issuer = clientId;
    }
    if (redirectUri) {
      options.audience = redirectUri;
    }
    return jwt.sign({ typ }, this.jwtSecret, options);
  };

  issueCode = (userId: UserId, clientId: string, redirectUri: string) =>
    this.issueToken("code", "5m", userId, clientId, redirectUri);

  exchangeCode = async (code: string, clientId: string, redirectUri: string) =>
    this.verifyToken(code, "code", clientId, redirectUri).then(user =>
      user
        ? [
            this.issueToken("access", this.accessTokenLifetime, user.id),
            this.issueToken("refresh", this.refreshTokenLifetime, user.id),
          ]
        : undefined
    );

  exchangeRefreshToken = async (token: string) =>
    this.verifyToken(token, "refresh").then(user =>
      user
        ? [
            this.issueToken("access", this.accessTokenLifetime, user.id),
            this.issueToken("refresh", this.refreshTokenLifetime, user.id),
          ]
        : undefined
    );

  verifyAccessTokenPayload = (payload: jwt.JwtPayload) =>
    this.verifyTokenPayload(payload, "access");

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

  delete = async (id: UserId) =>
    this.client.delete(users).where(eq(users.id, id)).run();
}
