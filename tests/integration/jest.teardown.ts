/**
 * Integration test teardown
 * Cleanup after all tests complete
 */

import { stopDockerCompose } from "./test-utils";

// Global teardown runs once after all test files
export default async function globalTeardown() {
  console.log("\n🧹 Integration Test Global Teardown\n");

  // Check if we should keep services running
  const keepRunning = process.env.KEEP_SERVICES_RUNNING === "true";

  if (keepRunning) {
    console.log(
      "⚠️  Keeping Docker Compose services running (KEEP_SERVICES_RUNNING=true)"
    );
    console.log("   Stop manually with: npm run docker:down");
  } else {
    // Stop Docker Compose
    stopDockerCompose();
    console.log("✅ Docker Compose services stopped");
  }

  console.log("✅ Integration test cleanup complete\n");
}
