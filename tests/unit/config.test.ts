import { beforeEach, describe, expect, it, vi } from "vitest";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Restore original env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe("googleServiceAccountJson", () => {
    it("should parse GOOGLE_SERVICE_ACCOUNT_JSON from base64 environment variable", async () => {
      const mockServiceAccount = {
        type: "service_account",
        project_id: "test-project",
      };
      const base64Encoded = Buffer.from(
        JSON.stringify(mockServiceAccount)
      ).toString("base64");

      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = base64Encoded;
      process.env.NODE_ENV = "development";

      const config = (await import("../../src/config.ts")).default;

      expect(config.googleServiceAccountJson).toBeDefined();
      expect(config.googleServiceAccountJson).toEqual(mockServiceAccount);
    });

    it("should decode base64 service account JSON correctly", async () => {
      const mockServiceAccount = {
        type: "service_account",
        project_id: "my-project-123",
        private_key_id: "key123",
        private_key:
          "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
        client_email: "test@test-project.iam.gserviceaccount.com",
        client_id: "123456789",
      };
      const base64Encoded = Buffer.from(
        JSON.stringify(mockServiceAccount)
      ).toString("base64");

      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = base64Encoded;
      process.env.NODE_ENV = "development";

      const config = (await import("../../src/config.ts")).default;

      expect(config.googleServiceAccountJson).toEqual(mockServiceAccount);
    });

    it("should allow missing GOOGLE_SERVICE_ACCOUNT_JSON in non-production environments", async () => {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      process.env.NODE_ENV = "development";

      const config = (await import("../../src/config.ts")).default;

      expect(config.googleServiceAccountJson).toBeUndefined();
    });

    it("should throw error when GOOGLE_SERVICE_ACCOUNT_JSON is missing in production environment", async () => {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      process.env.NODE_ENV = "production";

      await expect(async () => {
        await import("../../src/config.ts");
      }).rejects.toThrow("GOOGLE_SERVICE_ACCOUNT_JSON");
    });
  });
});
