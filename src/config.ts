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

const optStringEnvironment = (value: string): string | undefined => {
  return process.env[value];
};

const stringEnvironment = (value: string, fallback?: string): string => {
  return (
    process.env[value] ??
    fallback ??
    raise(`Missing required environment variable: ${value}`)
  );
};

const googleServiceAccountJson = (() => {
  const base64Value = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const isProduction =
    (process.env.NODE_ENV || "production").toLowerCase() === "production";

  if (!base64Value) {
    if (isProduction) {
      throw new Error(
        "Missing required environment variable: GOOGLE_SERVICE_ACCOUNT_JSON"
      );
    }
    return undefined;
  }

  try {
    const decoded = Buffer.from(base64Value, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch (error) {
    throw new Error(
      `Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
})();

export default {
  env: (process.env.NODE_ENV || "production").toLowerCase(),
  sentryDsn: stringEnvironment("SENTRY_DSN", ""),
  tcpPort: intEnvironment("TCP_PORT", 8042),
  httpPort: intEnvironment("HTTP_PORT", 8080),
  databaseUrl: stringEnvironment("DATABASE_URL"),
  jwtSecret: stringEnvironment("JWT_SECRET"),
  cookieSecret: stringEnvironment("COOKIE_SECRET"),
  sslCert: optStringEnvironment("SSL_CERT"),
  sslKey: optStringEnvironment("SSL_KEY"),
  googleHomeProjectId: stringEnvironment("GOOGLE_HOME_PROJECT_ID"),
  googleHomeOAuthClientId: stringEnvironment("GOOGLE_HOME_CLIENT_ID"),
  googleHomeOAuthClientSecret: stringEnvironment("GOOGLE_HOME_CLIENT_SECRET"),
  googleSsoClientId: stringEnvironment("GOOGLE_SSO_CLIENT_ID"),
  googleSsoClientSecret: stringEnvironment("GOOGLE_SSO_CLIENT_SECRET"),
  googleSsoRedirectUri: stringEnvironment("GOOGLE_SSO_REDIRECT_URI"),
  googleServiceAccountJson,
  accessTokenLifetime: intEnvironment("OAUTH_ACCESS_TOKEN_EXPIRES_IN", 3600), // 1 hour
  refreshTokenLifetime: intEnvironment(
    "OAUTH_REFRESH_TOKEN_EXPIRES_IN",
    1_209_600
  ),
};
