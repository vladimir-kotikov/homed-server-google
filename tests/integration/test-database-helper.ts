/**
 * Shared database initialization and seeding utilities for integration tests
 */
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { UserId } from "../../src/db/repository.ts";
import { UserRepository } from "../../src/db/repository.ts";
import * as schema from "../../src/db/schema.ts";
import { users } from "../../src/db/schema.ts";

export interface TestUser {
  id: UserId;
  username: string;
  clientToken: string;
}

/**
 * Initialize a test database with schema
 */
export function initializeTestDatabase(): Database.Database {
  const database = new Database(":memory:");
  const client = drizzle(database, { schema });

  // Create tables using Drizzle schema
  client.run(sql`
    CREATE TABLE "user" (
      "id" TEXT PRIMARY KEY,
      "username" TEXT NOT NULL,
      "client_token" TEXT NOT NULL UNIQUE,
      "created_at" INTEGER NOT NULL
    )
  `);

  client.run(sql`
    CREATE TABLE "sessions" (
      "sid" TEXT PRIMARY KEY,
      "sess" TEXT NOT NULL,
      "expire" TEXT NOT NULL
    )
  `);

  return database;
}

/**
 * Create a test user in the database
 */
export function createTestUser(
  database: Database.Database,
  overrides?: Partial<TestUser>
): TestUser {
  const client = drizzle(database, { schema });
  const user: TestUser = {
    id: (overrides?.id ?? "test-user-id") as UserId,
    username: overrides?.username ?? "test@example.com",
    clientToken: overrides?.clientToken ?? "test-token-123",
  };

  client
    .insert(users)
    .values({
      id: user.id,
      username: user.username,
      clientToken: user.clientToken as never,
    })
    .run();

  return user;
}

/**
 * Create a UserRepository with initialized test database
 */
export function createTestUserRepository(
  jwtSecret: string,
  testUser?: Partial<TestUser>
): { database: Database.Database; repository: UserRepository; user: TestUser } {
  const database = initializeTestDatabase();
  const repository = new UserRepository(database, jwtSecret);
  const user = createTestUser(database, testUser);

  return { database, repository, user };
}
