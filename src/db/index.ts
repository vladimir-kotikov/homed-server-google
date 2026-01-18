import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

let db: Database.Database | null = null;

export function initializeDatabase(databaseUrl: string) {
  // Parse SQLite URL (file:./path/to/db.db or :memory:)
  const dbPath = databaseUrl.replace("file:", "") || ":memory:";
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Create tables
  createTables(db);

  return db;
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

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase first.");
  }
  return db;
}

export function getDrizzle() {
  const database = getDatabase();
  return drizzle(database, { schema });
}

export async function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
