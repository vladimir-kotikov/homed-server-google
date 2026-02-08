import Database from "better-sqlite3";
import debug from "debug";
import { eq } from "drizzle-orm";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import jwt from "jsonwebtoken";
import * as schema from "./schema.ts";
import { users } from "./schema.ts";

import crypto from "node:crypto";

const log = debug("homed:user");

export type ClientToken = string & { readonly __clientToken: unique symbol };
export type UserId = string & { readonly __userId: unique symbol };

export interface User {
  id: UserId;
  username: string;
  clientToken: ClientToken;
  createdAt: Date;
}

export class UserRepository {
  readonly database: Database.Database;
  private readonly client: BetterSQLite3Database<typeof schema>;
  private readonly jwtSecret: string;

  constructor(database: Database.Database, jwtSecret: string) {
    this.database = database;
    this.client = drizzle(database, { schema });
    this.jwtSecret = jwtSecret;
  }

  static open(
    databasePath: string = ":memory:",
    jwtSecret: string,
    { create = false }: { create: boolean }
  ): UserRepository {
    log(
      `Opening database at ${databasePath} (create: ${create ? "yes" : "no"})`
    );
    const database = new Database(databasePath, { fileMustExist: !create });
    database.pragma("journal_mode = WAL");
    return new UserRepository(database, jwtSecret);
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
    const options = {} as jwt.VerifyOptions;
    if (clientId) {
      options.audience = redirectUri;
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
    expiresIn: string,
    userId: UserId,
    clientId?: string,
    redirectUri?: string
  ) => {
    const options = {
      subject: userId,
      expiresIn,
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
            this.issueToken("access", "1h", user.id),
            this.issueToken("refresh", "7d", user.id),
          ]
        : undefined
    );

  exchangeRefreshToken = async (token: string) =>
    this.verifyToken(token, "refresh").then(user =>
      user
        ? [
            this.issueToken("access", "1h", user.id),
            this.issueToken("refresh", "7d", user.id),
          ]
        : undefined
    );

  verifyAccessTokenPayload = (payload: jwt.JwtPayload) =>
    this.verifyTokenPayload(payload, "access");

  getOrCreate = (id: UserId, username: string): Promise<User> =>
    this.client.query.users
      .findFirst({ where: eq(users.id, id as UserId) })
      .then(
        user =>
          user ??
          this.client
            .insert(users)
            .values({
              id,
              username,
              clientToken: crypto
                .randomBytes(32)
                .toString("hex") as ClientToken,
            })
            .returning()
            .then(result => result[0])
      );

  getByToken = (token: ClientToken) =>
    this.client.query.users.findFirst({
      where: eq(users.clientToken, token),
    });

  delete = async (id: UserId) =>
    this.client.delete(users).where(eq(users.id, id)).run();
}
