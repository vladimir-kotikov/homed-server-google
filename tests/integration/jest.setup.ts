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

  // Check if database is seeded
  if (!testDatabaseExists()) {
    console.error("❌ Test database not found.");
    console.error("   Run: npm run seed:test");
    process.exit(1);
  }

  console.log("✅ Test database found");

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

  // Check if services are already running
  if (isDockerComposeRunning()) {
    console.log("⚠️  Docker Compose services already running");
    console.log("   Using existing services...");
  } else {
    // Start Docker Compose
    await startDockerCompose();
  }

  console.log("✅ Integration test environment ready\n");
}
