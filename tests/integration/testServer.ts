import * as childProcess from "child_process";
import * as fs from "fs/promises";
import jwt from "jsonwebtoken";
/**
 * Test Server Wrapper
 *
 * Provides a test-friendly HTTP interface to query the running server's state
 * and call the fulfillment endpoint.
 *
 * All interactions go through HTTP - the server runs as a truly independent
 * subprocess, making these tests fully integrative.
 *
 * Usage:
 * ```typescript
 * // In beforeAll:
 * setServer(new ServerWrapper(baseUrl, accessToken))
 *
 * // In tests:
 * await server.getClients() // Get list of connected client uniqueIds
 * await server.callFulfillment("SYNC", {}) // Call fulfillment endpoint
 * ```
 */

/**
 * Test server wrapper - queries running server via HTTP
 * Ensures tests are truly integrative with server running as independent process
 */
export class TestServerWrapper {
  baseUrl: string;
  testDbPath: string;
  accessToken?: string;
  clientToken?: string;
  env: Record<string, string>;
  userId?: string;

  private serverProcess: childProcess.ChildProcessWithoutNullStreams | null =
    null;

  constructor(env: Record<string, string>, testDbPath: string) {
    this.env = env;
    this.baseUrl = `http://localhost:${env.PORT || 9080}`;
    this.testDbPath = testDbPath;
  }

  async start(): Promise<this> {
    await fs.unlink(this.testDbPath).catch(() => {});

    const { promise, resolve, reject } = Promise.withResolvers<this>();
    const startupTimeout = setTimeout(
      () => reject(new Error("Server startup timeout")),
      5000
    );

    this.serverProcess = childProcess
      .spawn("node", ["src/index.ts"], {
        env: { ...process.env, ...this.env },
        stdio: "pipe",
        cwd: process.cwd(),
      })
      .on("error", reject);

    let output = "";
    const outputHandler = (data: Buffer) => {
      output += data.toString();
      if (output.includes("HTTP Server listening on port")) {
        clearTimeout(startupTimeout);
        this.serverProcess?.stdout.off("data", outputHandler);
        this.serverProcess?.stderr.off("data", outputHandler);
        resolve(this);
      }
    };
    this.serverProcess.stdout.on("data", outputHandler);
    this.serverProcess.stderr.on("data", outputHandler);

    return promise;
  }

  stop(): Promise<void> {
    return new Promise(resolve => {
      if (!this.serverProcess) {
        resolve();
        return;
      }

      this.serverProcess.on("exit", () => {
        this.serverProcess = null;
        resolve();
      });
      this.serverProcess.kill();
    });
  }

  async login(): Promise<this> {
    // Login and get access token
    const loginResponse = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test", password: "test" }),
    });

    const loginData = await loginResponse.json();
    this.userId = loginData.id;
    this.clientToken = loginData.clientToken;

    this.accessToken = jwt.sign(
      { userId: this.userId, type: "access" },
      this.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return this;
  }

  async getHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async getClients(): Promise<string[]> {
    if (!this.accessToken) {
      throw new Error("Access token not set. Call login() first.");
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };

    const response = await fetch(`${this.baseUrl}/api/clients`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to get clients: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as { clients?: string[] };
    return data.clients || [];
  }

  /**
   * Call the fulfillment endpoint
   * HTTP POST /fulfillment
   *
   * @param intent The fulfillment intent (e.g., "SYNC", "QUERY", "EXECUTE")
   * @param payload The fulfillment payload
   * @returns Response object with status and parsed data
   */
  async callFulfillment(
    intent: string,
    payload: Record<string, unknown>
  ): Promise<{ response: Response; data: Record<string, unknown> | null }> {
    const request = {
      requestId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      inputs: [
        {
          intent:
            intent === "SYNC"
              ? "action.devices.SYNC"
              : intent === "QUERY"
                ? "action.devices.QUERY"
                : intent === "EXECUTE"
                  ? "action.devices.EXECUTE"
                  : intent, // Pass through custom intents as-is
          payload: payload,
        },
      ],
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };

    const response = await fetch(`${this.baseUrl}/fulfillment`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    let data: Record<string, unknown> | null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return { response, data };
  }
}
