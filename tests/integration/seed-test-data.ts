#!/usr/bin/env ts-node

import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load test environment
dotenv.config({ path: path.join(__dirname, ".env.test") });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "file:./tests/integration/test.db",
    },
  },
});

async function seedTestData() {
  console.log("🌱 Seeding test data...");

  try {
    // Clean existing data
    await prisma.refreshToken.deleteMany();
    await prisma.authCode.deleteMany();
    await prisma.user.deleteMany();

    // Generate client token (32-byte hex string)
    const clientToken = crypto.randomBytes(32).toString("hex");

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

    // Generate homed-cloud.conf from template
    const templatePath = path.join(__dirname, "homed-cloud.conf.template");
    const configPath = path.join(__dirname, "homed-cloud.conf");

    const template = fs.readFileSync(templatePath, "utf-8");
    const config = template.replace("{{CLIENT_TOKEN}}", clientToken);

    fs.writeFileSync(configPath, config);
    console.log(`✅ Client configuration written to: ${configPath}`);

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
