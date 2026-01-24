const raise = (message: string): never => {
  throw new Error(message);
};

const intEnvironment = (value: string, fallback?: number): number => {
  const parsed = Number.parseInt(process.env[value] || "", 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback ?? raise(`Missing or invalid environment variable: ${value}`);
};

const stringEnvironment = (value: string, fallback?: string): string => {
  return (
    process.env[value] ??
    fallback ??
    raise(`Missing required environment variable: ${value}`)
  );
};

const DEFAULT_DATABASE_URL = "dev.db";
const DEV_OAUTH_CLIENT_ID = "dev-oauth-client-id";
const DEV_OAUTH_CLIENT_SECRET = "dev-oauth-client-secret";
const DEV_JWT_SECRET = "dev-jwt-secret";

export default {
  env: (process.env.NODE_ENV || "production").toLowerCase(),
  tcpPort: intEnvironment("TCP_PORT", 8042),
  httpPort: intEnvironment("HTTP_PORT", 8080),
  databaseUrl: stringEnvironment("DATABASE_URL", DEFAULT_DATABASE_URL),
  jwtSecret: stringEnvironment("JWT_SECRET", DEV_JWT_SECRET),
  cookieSecret: stringEnvironment("COOKIE_SECRET", DEV_JWT_SECRET),
  oauthClientId: stringEnvironment("OAUTH_CLIENT_ID", DEV_OAUTH_CLIENT_ID),
  oauthClientSecret: stringEnvironment(
    "OAUTH_CLIENT_SECRET",
    DEV_OAUTH_CLIENT_SECRET
  ),
  oauthRedirectUri: stringEnvironment(
    "OAUTH_REDIRECT_URI",
    "http://localhost:8080/oauth/callback"
  ),
  googleUserClientId: stringEnvironment("GOOGLE_USER_CLIENT_ID"),
  googleUserClientSecret: stringEnvironment("GOOGLE_USER_CLIENT_SECRET"),
  googleUserRedirectUri: stringEnvironment("GOOGLE_USER_REDIRECT_URI"),
  accessTokenLifetime: intEnvironment("OAUTH_ACCESS_TOKEN_EXPIRES_IN", 3600), // 1 hour
  refreshTokenLifetime: intEnvironment(
    "OAUTH_REFRESH_TOKEN_EXPIRES_IN",
    1_209_600
  ), // 14 days
};
