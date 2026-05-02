import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { ClientId } from "../homed/client.ts";
import type { DeviceId } from "../device.ts";
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

// Devices table - persists device information across restarts
export const devices = sqliteTable(
  "device",
  {
    userId: text("user_id").notNull().$type<UserId>(),
    clientId: text("client_id").notNull().$type<ClientId>(),
    deviceId: text("device_id").notNull().$type<DeviceId>(),
    deviceData: text("device_data").notNull(), // JSON-serialized HomedDevice
    lastSeen: integer("last_seen", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    available: integer("available", { mode: "boolean" }).default(true),
  },
  table => ({
    pk: primaryKey({ columns: [table.userId, table.clientId, table.deviceId] }),
  })
);
