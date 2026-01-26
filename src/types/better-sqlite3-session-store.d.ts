declare module "better-sqlite3-session-store" {
  import type Database from "better-sqlite3";
  import type { SessionOptions, Store } from "express-session";

  interface SqliteStoreOptions {
    client: Database.Database;
    expired?: {
      clear?: boolean;
      intervalMs?: number;
    };
  }

  interface SqliteStoreConstructor {
    new (options: SqliteStoreOptions): Store;
  }

  function SqliteStore(
    session: (options?: SessionOptions) => Session
  ): SqliteStoreConstructor;

  export default SqliteStore;
}
