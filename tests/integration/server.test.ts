import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const TEST_DB_PATH = path.join(
  process.cwd(),
  "tests",
  "integration",
  "test-integration.db"
);

const TEST_ENV = {
  NODE_ENV: "test",
  PORT: String(9080),
  TCP_PORT: String(9042),
  DATABASE_URL: `file:${TEST_DB_PATH}`,
  GOOGLE_USER_CLIENT_ID: "test-client-id",
  GOOGLE_USER_CLIENT_SECRET: "test-client-secret",
  GOOGLE_USER_REDIRECT_URI: "http://localhost:9080/auth/google/callback",
  JWT_SECRET: "test-jwt-secret",
  OAUTH_CLIENT_ID: "google-oauth-client-id",
};

const SERVER_URL = `http://localhost:${TEST_ENV.PORT}`;

const callFulfillment = async (request: unknown, token: string | null) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${SERVER_URL}/fulfillment`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  let data: any;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { response, data };
};

const expectValidFulfillmentResponse = (
  data: unknown,
  requestId: string,
  payloadShape?: Record<string, any>
) => {
  const expectedShape: Record<string, any> = {
    requestId,
    payload: expect.anything(),
  };

  if (payloadShape) {
    expectedShape.payload = expect.objectContaining(payloadShape);
  }

  expect(data).toMatchObject(expectedShape);
};

describe("Server Integration Tests", () => {
  let serverProcess: childProcess.ChildProcess | null = null;

  beforeAll(async () => {
    await fs.promises.unlink(TEST_DB_PATH).catch(() => {});
    serverProcess = childProcess.spawn(
      "node",
      ["--experimental-strip-types", "src/index.ts"],
      {
        env: { ...process.env, ...TEST_ENV },
        stdio: "pipe",
        cwd: process.cwd(),
      }
    );

    // Wait for server to be ready by polling the healthcheck endpoint
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Server failed to start within timeout"));
      }, 10000);

      let output = "";
      let healthcheckStarted = false;

      const checkHealth = async () => {
        try {
          const response = await fetch(`${SERVER_URL}/health`);
          if (response.ok) {
            const data = await response.json();
            if (data.status === "ok") {
              clearTimeout(timeout);
              serverProcess!.stdout!.off("data", onData);
              serverProcess!.stderr!.off("data", onData);
              resolve();
              return;
            }
          }
        } catch {
          // Server not ready yet, will retry
        }

        // Retry after 200ms
        setTimeout(checkHealth, 200);
      };

      const onData = (data: Buffer) => {
        const text = data.toString();
        output += text;

        // Start health checks once we see the HTTP server has started
        if (
          output.includes("HTTP Server listening on port") &&
          !healthcheckStarted
        ) {
          healthcheckStarted = true;
          checkHealth();
        }

        // Check for startup errors
        if (output.includes("Error:") && !text.includes("TCP Server error:")) {
          clearTimeout(timeout);
          serverProcess!.stdout!.off("data", onData);
          serverProcess!.stderr!.off("data", onData);
          reject(new Error(`Server startup error: ${text}`));
        }
      };

      serverProcess!.stdout!.on("data", onData);
      serverProcess!.stderr!.on("data", onData);
    });
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise<void>(resolve => {
        serverProcess!.on("exit", () => {
          resolve();
        });
        // Force kill after 5 seconds if graceful shutdown fails
        setTimeout(() => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill("SIGKILL");
          }
          resolve();
        }, 5000);
      });
    }

    await fs.promises
      .unlink(TEST_DB_PATH)
      .catch(error => console.warn("Failed to clean up test database:", error));
  });

  test("server should start cleanly", async () => {
    // If we got here, the server started successfully in beforeAll
    expect(serverProcess).not.toBeNull();
    expect(serverProcess!.killed).toBe(false);

    // Verify the server is responding via healthcheck
    const response = await fetch(`${SERVER_URL}/health`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("status");
    expect(data.status).toBe("ok");
    expect(data).toHaveProperty("timestamp");
  });

  test("server should serve the login endpoint", async () => {
    const response = await fetch(`${SERVER_URL}/`);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();

    // Verify the page contains expected elements
    expect(html).toContain("Homed Server");
    expect(html).toContain("Sign in with Google");

    // In test environment, should show test login form
    expect(html).toContain("Test Login");
    expect(html).toContain('id="username"');
    expect(html).toContain('id="password"');
  });

  test("server should accept test/test login", async () => {
    // First, verify we're not authenticated
    const homeResponse = await fetch(`${SERVER_URL}/`);
    const homeHtml = await homeResponse.text();
    expect(homeHtml).toContain("Sign in with Google"); // Login page, not dashboard

    // Attempt to login with test credentials
    const loginResponse = await fetch(`${SERVER_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "test",
        password: "test",
      }),
    });

    expect(loginResponse.ok).toBe(true);
    const loginData = await loginResponse.json();

    expect(loginData).toHaveProperty("success");
    expect(loginData.success).toBe(true);
    expect(loginData).toHaveProperty("username");
    expect(loginData.username).toBe("test");
    expect(loginData).toHaveProperty("clientToken");
    expect(typeof loginData.clientToken).toBe("string");
    expect(loginData.clientToken.length).toBeGreaterThan(0);
  });

  test("server should reject invalid credentials", async () => {
    const loginResponse = await fetch(`${SERVER_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "test",
        password: "wrongpassword",
      }),
    });

    expect(loginResponse.status).toBe(401);
    const loginData = await loginResponse.json();

    expect(loginData).toHaveProperty("error");
    expect(loginData.error).toContain("Invalid");
  });

  test("server should reject login without credentials", async () => {
    const loginResponse = await fetch(`${SERVER_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(loginResponse.status).toBe(400);
    const loginData = await loginResponse.json();

    expect(loginData).toHaveProperty("error");
    expect(loginData.error).toContain("Missing");
  });
});

describe("Fulfillment Endpoint Integration Tests", () => {
  let serverProcess: childProcess.ChildProcess | null = null;
  let userId: string;
  let accessToken: string;

  beforeAll(async () => {
    await fs.promises.unlink(TEST_DB_PATH).catch(() => {});
    serverProcess = childProcess.spawn(
      "node",
      ["--experimental-strip-types", "src/index.ts"],
      {
        env: { ...process.env, ...TEST_ENV },
        stdio: "pipe",
        cwd: process.cwd(),
      }
    );

    // Wait for server to be ready by polling the healthcheck endpoint
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Server failed to start within timeout"));
      }, 10000);

      let healthcheckStarted = false;

      const checkHealth = async () => {
        try {
          const response = await fetch(`${SERVER_URL}/health`);
          if (response.ok) {
            const data = await response.json();
            if (data.status === "ok") {
              clearTimeout(timeout);
              serverProcess!.stdout!.off("data", onData);
              serverProcess!.stderr!.off("data", onData);
              resolve();
              return;
            }
          }
        } catch {
          // Server not ready yet, will retry
        }

        // Retry after 200ms
        setTimeout(checkHealth, 200);
      };

      const onData = (data: Buffer) => {
        const text = data.toString();

        // Start health checks once we see the HTTP server has started
        if (
          text.includes("HTTP Server listening on port") &&
          !healthcheckStarted
        ) {
          healthcheckStarted = true;
          checkHealth();
        }

        if (text.includes("Error:") && !text.includes("TCP Server error:")) {
          clearTimeout(timeout);
          serverProcess!.stdout!.off("data", onData);
          serverProcess!.stderr!.off("data", onData);
          reject(new Error(`Server startup error: ${text}`));
        }
      };

      serverProcess!.stdout!.on("data", onData);
      serverProcess!.stderr!.on("data", onData);
    });

    // Login to get user ID and generate access token
    const loginResponse = await fetch(`${SERVER_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test", password: "test" }),
    });

    const loginData = await loginResponse.json();

    // Generate access token using JWT
    const jwt = await import("jsonwebtoken");
    userId = loginData.username; // Use username as userId for simplicity
    accessToken = jwt.default.sign(
      { userId, type: "access" },
      TEST_ENV.JWT_SECRET,
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await new Promise<void>(resolve => {
        serverProcess!.on("exit", () => resolve());
        setTimeout(() => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill("SIGKILL");
          }
          resolve();
        }, 5000);
      });
    }

    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (error) {
        console.warn("Failed to clean up test database:", error);
      }
    }
  });

  test("should reject fulfillment request without authorization", async () => {
    const { response, data } = await callFulfillment(
      {
        requestId: "test-request-1",
        inputs: [{ intent: "action.devices.SYNC" }],
      },
      null
    );

    expect(response.status).toBe(401);
    expect(data.error).toBe("unauthorized");
  });

  test("should reject fulfillment request with invalid token", async () => {
    const { response, data } = await callFulfillment(
      {
        requestId: "test-request-2",
        inputs: [{ intent: "action.devices.SYNC" }],
      },
      "invalid-token"
    );

    expect(response.status).toBe(401);
    expect(data.error).toBe("invalid_token");
  });

  test("should reject fulfillment request with invalid format", async () => {
    const { response, data } = await callFulfillment(
      { invalid: "request" },
      accessToken
    );

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid request format");
  });

  test("should handle SYNC intent", async () => {
    const { response, data } = await callFulfillment(
      {
        requestId: "test-sync-request",
        inputs: [{ intent: "action.devices.SYNC" }],
      },
      accessToken
    );

    expect(response.ok).toBe(true);
    expectValidFulfillmentResponse(data, "test-sync-request", {
      agentUserId: expect.any(String),
      devices: expect.any(Array),
    });
  });

  test("should handle QUERY intent", async () => {
    const { response, data } = await callFulfillment(
      {
        requestId: "test-query-request",
        inputs: [
          {
            intent: "action.devices.QUERY",
            payload: {
              devices: [{ id: "test-device-1" }],
            },
          },
        ],
      },
      accessToken
    );

    expect(response.ok).toBe(true);
    expectValidFulfillmentResponse(data, "test-query-request", {
      devices: expect.any(Object),
    });
  });

  test("should handle EXECUTE intent", async () => {
    const { response, data } = await callFulfillment(
      {
        requestId: "test-execute-request",
        inputs: [
          {
            intent: "action.devices.EXECUTE",
            payload: {
              commands: [
                {
                  devices: [{ id: "test-device-1" }],
                  execution: [
                    {
                      command: "action.devices.commands.OnOff",
                      params: { on: true },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      accessToken
    );

    expect(response.ok).toBe(true);
    expectValidFulfillmentResponse(data, "test-execute-request", {
      commands: expect.arrayContaining([
        expect.objectContaining({
          ids: expect.any(Array),
          status: expect.stringMatching(/^(SUCCESS|ERROR|OFFLINE)$/),
        }),
      ]),
    });
  });

  test("should handle DISCONNECT intent", async () => {
    const { response, data } = await callFulfillment(
      {
        requestId: "test-disconnect-request",
        inputs: [{ intent: "action.devices.DISCONNECT" }],
      },
      accessToken
    );

    expect(response.ok).toBe(true);
    expectValidFulfillmentResponse(data, "test-disconnect-request", {});
  });

  test("should reject unknown intent", async () => {
    const { response, data } = await callFulfillment(
      {
        requestId: "test-unknown-intent",
        inputs: [{ intent: "action.devices.UNKNOWN" }],
      },
      accessToken
    );

    expect(response.status).toBe(400);
    expect(data.error).toContain("Unknown intent");
  });
});
