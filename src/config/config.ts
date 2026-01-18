import dotenv from "dotenv";

export interface AppConfig {
  env: string;
  isDev: boolean;
  isTest: boolean;
  isProd: boolean;
  tcpPort: number;
  httpPort: number;
  databaseUrl: string;
  allowAutoSeed: boolean;
}

const DEFAULT_DATABASE_URL = "file:./prisma/dev.db";
const DEV_OAUTH_CLIENT_ID = "dev-oauth-client-id";
const DEV_OAUTH_CLIENT_SECRET = "dev-oauth-client-secret";
const DEV_JWT_SECRET = "dev-jwt-secret";

function normalizeEnv(value: string | undefined, fallback: string): string {
  const parsed = parseInt(value || "", 10);
  if (Number.isFinite(parsed)) {
    return String(parsed);
  }
  return fallback;
}

export function loadConfig(): AppConfig {
  dotenv.config();

  const env = (process.env.NODE_ENV || "development").toLowerCase();
  const isTest = env === "test";
  const isDev = env === "development";
  const isProd = env === "production";

  const tcpPort = parseInt(normalizeEnv(process.env.TCP_PORT, "8042"), 10);
  const httpPort = parseInt(normalizeEnv(process.env.PORT, "8080"), 10);

  const databaseUrl =
    process.env.DATABASE_URL || (!isProd ? DEFAULT_DATABASE_URL : "");

  if (!process.env.DATABASE_URL && databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }

  if (!process.env.OAUTH_CLIENT_ID && !isProd) {
    process.env.OAUTH_CLIENT_ID = DEV_OAUTH_CLIENT_ID;
  }

  if (!process.env.OAUTH_CLIENT_SECRET && !isProd) {
    process.env.OAUTH_CLIENT_SECRET = DEV_OAUTH_CLIENT_SECRET;
  }

  if (!process.env.JWT_SECRET && !isProd) {
    process.env.JWT_SECRET = DEV_JWT_SECRET;
  }

  const requiredProdEnv: string[] = [];
  if (isProd && !process.env.DATABASE_URL) {
    requiredProdEnv.push("DATABASE_URL");
  }
  if (
    isProd &&
    (!process.env.OAUTH_CLIENT_ID || !process.env.OAUTH_CLIENT_SECRET)
  ) {
    requiredProdEnv.push("OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET");
  }
  if (isProd && !process.env.JWT_SECRET) {
    requiredProdEnv.push("JWT_SECRET");
  }

  if (requiredProdEnv.length > 0) {
    const unique = [...new Set(requiredProdEnv)];
    throw new Error(
      `Missing required environment variables for production: ${unique.join(", ")}`
    );
  }

  const allowAutoSeed = (() => {
    if (process.env.ALLOW_DEV_AUTO_SEED !== undefined) {
      return ["1", "true", "yes"].includes(
        process.env.ALLOW_DEV_AUTO_SEED.toLowerCase()
      );
    }
    return isDev || isTest;
  })();

  return {
    env,
    isDev,
    isTest,
    isProd,
    tcpPort,
    httpPort,
    databaseUrl,
    allowAutoSeed,
  };
}
