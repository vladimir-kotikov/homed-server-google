#!/usr/bin/env ts-node

import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load test environment
dotenv.config({ path: path.join(__dirname, ".env.test") });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${path.join(__dirname, "test.db")}`,
    },
  },
});

async function seedTestData() {
  console.log("🌱 Seeding test data...");

  try {
    // Note: Database schema will be created by Docker container via prisma migrate deploy
    // We just create the file here and seed data
    const dbPath = path.join(__dirname, "test.db");
    if (!fs.existsSync(dbPath)) {
      console.log("📄 Creating empty database file...");
      fs.writeFileSync(dbPath, "");
    }

    // Clean existing data (only if tables exist)
    try {
      await prisma.refreshToken.deleteMany();
      await prisma.authCode.deleteMany();
      await prisma.user.deleteMany();
    } catch (error) {
      // Tables don't exist yet - that's okay, Docker will create them
      console.log(
        "ℹ️  Database tables not yet created (Docker will handle this)"
      );
    }

    // Use static token for integration tests (prevents sync issues)
    const clientToken =
      "13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e";

    // Create test user
    const user = await prisma.user.create({
      data: {
        username: process.env.TEST_USERNAME || "test-user",
        passwordHash: await bcrypt.hash(
          process.env.TEST_PASSWORD || "test-password",
          10
        ),
        clientToken,
      },
    });

    console.log("✅ Test user created:");
    console.log(`   Username: ${user.username}`);
    console.log(`   Password: ${process.env.TEST_PASSWORD || "test-password"}`);
    console.log(`   Client Token: ${clientToken}`);
    console.log(`   User ID: ${user.id}`);

    console.log("\n📋 Next steps:");
    console.log("   1. Start integration environment: docker-compose up -d");
    console.log("   2. Check logs: docker-compose logs -f");
    console.log("   3. Run integration tests: npm run test:integration");
  } catch (error) {
    console.error("❌ Error seeding test data:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  seedTestData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { seedTestData };
