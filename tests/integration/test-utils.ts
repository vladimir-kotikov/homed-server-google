/**
 * Integration test utilities
 * Helper functions for Docker-based integration testing
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface ServiceHealthCheck {
  service: string;
  healthy: boolean;
  error?: string;
}

/**
 * Wait for a service to become healthy
 */
export async function waitForService(
  serviceName: string,
  timeoutMs: number = 30000,
  intervalMs: number = 1000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = execSync(
        `docker compose -f tests/integration/docker-compose.yml ps --services --filter "status=running" | grep ${serviceName}`,
        { encoding: "utf-8", cwd: process.cwd() }
      );

      if (result.trim() === serviceName) {
        // Service is running, check health (if it has a healthcheck)
        try {
          const healthResult = execSync(
            `docker inspect --format='{{.State.Health.Status}}' homed-test-${serviceName}`,
            { encoding: "utf-8", cwd: process.cwd() }
          ).trim();

          if (healthResult === "healthy") {
            console.log(`✅ Service ${serviceName} is ready`);
            return;
          }
        } catch {
          // No health check defined, just check if running
          const statusResult = execSync(
            `docker inspect --format='{{.State.Status}}' homed-test-${serviceName}`,
            { encoding: "utf-8", cwd: process.cwd() }
          ).trim();

          if (statusResult === "running") {
            console.log(`✅ Service ${serviceName} is ready`);
            return;
          }
        }
      }
    } catch {
      // Service not ready yet
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timeout waiting for service ${serviceName} to become healthy`
  );
}

/**
 * Check if Docker Compose is running
 */
export function isDockerComposeRunning(): boolean {
  try {
    const result = execSync(
      "docker compose -f tests/integration/docker-compose.yml ps -q",
      {
        encoding: "utf-8",
        cwd: process.cwd(),
      }
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Start Docker Compose services
 */
export async function startDockerCompose(): Promise<void> {
  console.log("🚀 Starting Docker Compose services...");

  execSync("docker compose -f tests/integration/docker-compose.yml up -d", {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  // Wait for all services
  await waitForService("mqtt", 30000);
  await waitForService("tcp-server", 30000);
  await waitForService("homed-client", 30000);

  console.log("✅ All services are running");
}

/**
 * Stop Docker Compose services
 */
export function stopDockerCompose(): void {
  console.log("🛑 Stopping Docker Compose services...");
  execSync("docker compose -f tests/integration/docker-compose.yml down", {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

/**
 * Get logs from a service
 */
export function getServiceLogs(
  serviceName: string,
  lines: number = 50
): string {
  try {
    return execSync(
      `docker compose -f tests/integration/docker-compose.yml logs --tail=${lines} ${serviceName}`,
      { encoding: "utf-8", cwd: process.cwd() }
    );
  } catch {
    return "";
  }
}

/**
 * Check if test database exists
 */
export function testDatabaseExists(): boolean {
  return fs.existsSync(path.join(process.cwd(), "tests/integration/test.db"));
}

/**
 * Read test configuration
 */
export function readTestConfig(): {
  username: string;
  password: string;
  clientToken: string;
} {
  const envPath = path.join(process.cwd(), "tests/integration/.env.test");
  const configPath = path.join(
    process.cwd(),
    "tests/integration/homed-cloud.conf"
  );

  if (!fs.existsSync(envPath) || !fs.existsSync(configPath)) {
    throw new Error("Test configuration not found. Run: npm run seed:test");
  }

  // Parse .env.test
  const envContent = fs.readFileSync(envPath, "utf-8");
  const username = envContent.match(/TEST_USERNAME=(.+)/)?.[1] || "test-user";
  const password =
    envContent.match(/TEST_PASSWORD=(.+)/)?.[1] || "test-password";

  // Parse homed-cloud.conf
  const configContent = fs.readFileSync(configPath, "utf-8");
  const clientToken = configContent.match(/token = (.+)/)?.[1] || "";

  return { username, password, clientToken };
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 500,
  errorMessage: string = "Timeout waiting for condition"
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(errorMessage);
}

/**
 * Wait for a log condition to be met by polling service logs
 * Much faster than fixed delays - polls every 300ms with configurable timeout
 */
export async function waitForLogCondition(
  serviceName: string,
  checkFn: (logs: string) => boolean,
  timeoutMs: number = 10000,
  intervalMs: number = 300
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const logs = getServiceLogs(serviceName, 100);
    if (checkFn(logs)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timeout waiting for log condition in ${serviceName} after ${timeoutMs}ms`
  );
}

/**
 * Delay helper
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
