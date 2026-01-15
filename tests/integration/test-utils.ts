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
 * Get logs from a service
 */
export function getServiceLogs(
  serviceName: string,
  lines: number = 50
): string {
  try {
    return execSync(`docker compose logs --tail=${lines} ${serviceName}`, {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
  } catch {
    return "";
  }
}

/**
 * Read test configuration
 */
export function readTestConfig(): {
  username: string;
  password: string;
  clientToken: string;
} {
  const envPath = path.join(process.cwd(), ".env.test");
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
