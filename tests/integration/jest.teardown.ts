/**
 * Integration test teardown
 * Cleanup after all tests complete
 */

import { stopDockerCompose } from "./test-utils";

// Global teardown runs once after all test files
export default async function globalTeardown() {
  console.log("\n🧹 Integration Test Global Teardown\n");

  // Keep services running by default for local development (not CI)
  const keepServices =
    process.env.KEEP_SERVICES_RUNNING === "true" ||
    (process.env.CI !== "true" &&
      process.env.KEEP_SERVICES_RUNNING !== "false");

  if (keepServices) {
    console.log(
      "✅ Keeping Docker Compose services running for next test run (set KEEP_SERVICES_RUNNING=false to stop)"
    );
    console.log("   Stop manually with: npm run docker:down");
  } else {
    // Stop Docker Compose
    stopDockerCompose();
    console.log("✅ Docker Compose services stopped");
  }

  console.log("✅ Integration test cleanup complete\n");
}
