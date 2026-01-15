/**
 * Integration test setup
 * Ensures Docker environment is ready before running tests
 */

import { execSync } from "child_process";
import {
  isDockerComposeRunning,
  startDockerCompose,
  testDatabaseExists,
} from "./test-utils";

// Global setup runs once before all test files
export default async function globalSetup() {
  console.log("\n🔧 Integration Test Global Setup\n");

  // Check if database needs to be seeded
  if (!testDatabaseExists()) {
    console.log("📦 Test database not found, provisioning...");
    try {
      execSync("npm run seed:test", {
        cwd: process.cwd(),
        stdio: "inherit",
      });
      console.log("✅ Test database provisioned");
    } catch (error) {
      console.error("❌ Failed to provision test database");
      throw error;
    }
  } else {
    console.log("✅ Test database found");
  }

  // Check if Docker is available
  try {
    execSync("docker --version", { stdio: "ignore" });
    execSync("docker compose version", { stdio: "ignore" });
  } catch {
    console.error("❌ Docker or Docker Compose not found.");
    console.error("   Please install Docker Desktop or Docker Engine");
    process.exit(1);
  }

  console.log("✅ Docker is available");

  // Enable container reuse by default for local development (not CI)
  const keepServices =
    process.env.KEEP_SERVICES_RUNNING === "true" ||
    (process.env.CI !== "true" &&
      process.env.KEEP_SERVICES_RUNNING !== "false");

  // Check if services are already running
  if (isDockerComposeRunning()) {
    if (keepServices) {
      console.log(
        "✅ Docker Compose services already running, reusing them (saves ~90s)"
      );
    } else {
      console.log("⚠️  Docker Compose services already running");
      console.log("   Using existing services...");
    }
  } else {
    // Start Docker Compose
    const startTime = Date.now();
    console.log(
      "🚀 Starting Docker Compose services (this may take 60-120s on first run)..."
    );
    await startDockerCompose();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Services started in ${elapsed}s`);
  }

  if (!process.env.CI && keepServices) {
    console.log(
      "💡 Tip: Services will be kept running after tests for faster subsequent runs"
    );
  }

  console.log("✅ Integration test environment ready\n");
}
