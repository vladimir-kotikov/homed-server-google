import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import * as jwt from "jsonwebtoken";
import * as schema from "./schema.ts";
import { users } from "./schema.ts";

import crypto from "node:crypto";

export interface User {
  id: string;
  username: string;
  clientToken: string;
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
    console.log(
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

    return this.client.query.users.findFirst({ where: eq(users.id, sub) });
  };

  private verifyToken = async (
    token: string,
    expectedType: string,
    clientId?: string,
    redirectUri?: string
  ) => {
    const options = {};
    if (clientId) {
      (options as jwt.VerifyOptions).audience = redirectUri;
      (options as jwt.VerifyOptions).issuer = clientId;
    }
    const payload = jwt.verify(
      token,
      this.jwtSecret,
      options
    ) as jwt.JwtPayload;
    return this.verifyTokenPayload(payload, expectedType);
  };

  private issueToken = (
    typ: "code" | "access" | "refresh",
    expiresIn: string,
    userId: string,
    clientId?: string,
    redirectUri?: string
  ) =>
    jwt.sign({ typ }, this.jwtSecret, {
      subject: userId,
      issuer: clientId,
      audience: redirectUri,
      expiresIn,
    } as jwt.SignOptions);

  issueCode = (userId: string, clientId: string, redirectUri: string) =>
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

  getOrCreate = (id: string, username: string): Promise<User> =>
    this.client.query.users.findFirst({ where: eq(users.id, id) }).then(
      user =>
        user ??
        this.client
          .insert(users)
          .values({
            id,
            username,
            clientToken: crypto.randomBytes(32).toString("hex"),
          })
          .returning()
          .then(result => result[0])
    );

  getByToken = (token: string) =>
    this.client.query.users.findFirst({ where: eq(users.clientToken, token) });
}
