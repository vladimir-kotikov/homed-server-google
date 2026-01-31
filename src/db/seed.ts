import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";
import { users } from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL;
const environment = process.env.NODE_ENV || "development";

if (environment === "production") {
  console.error("Seeding should not be run in production environment");
  process.exit(1);
}

if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

console.log(`Seeding database at ${databaseUrl}`);

const database = new Database(databaseUrl);
const client = drizzle(database, { schema });

// Insert test user from homed.conf
const testUser = {
  id: "test-client",
  username: "test-client",
  clientToken: "token",
  createdAt: new Date(),
};

try {
  const result = await client
    .insert(users)
    .values(testUser)
    .onConflictDoNothing()
    .returning();

  if (result.length > 0) {
    console.log("✓ Test user created:", testUser.id);
  } else {
    console.log("✓ Test user already exists:", testUser.id);
  }

  console.log("Seeding completed successfully");
} catch (error) {
  console.error("Failed to seed database:", error);
  process.exit(1);
} finally {
  database.close();
}
