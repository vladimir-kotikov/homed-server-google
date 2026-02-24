import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ClientToken, UserId } from "./repository.ts";

export const users = sqliteTable("user", {
  id: text("id").primaryKey().$type<UserId>(),
  username: text("username").notNull(),
  clientToken: text("client_token").notNull().unique().$type<ClientToken>(),
  linked: integer("linked", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Sessions table, created by session store
export const sessions = sqliteTable("sessions", {
  sid: text("sid").primaryKey(),
  sess: text("sess").notNull(),
  expire: text("expire").notNull(),
});
