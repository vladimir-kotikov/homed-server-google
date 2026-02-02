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

export default {
  env: (process.env.NODE_ENV || "production").toLowerCase(),
  sentryDsn: stringEnvironment("SENTRY_DSN", ""),
  tcpPort: intEnvironment("TCP_PORT", 8042),
  httpPort: intEnvironment("HTTP_PORT", 8080),
  databaseUrl: stringEnvironment("DATABASE_URL"),
  jwtSecret: stringEnvironment("JWT_SECRET"),
  cookieSecret: stringEnvironment("COOKIE_SECRET"),
  googleHomeProjectId: stringEnvironment("GOOGLE_HOME_PROJECT_ID"),
  googleHomeOAuthClientId: stringEnvironment("GOOGLE_HOME_CLIENT_ID"),
  googleHomeOAuthClientSecret: stringEnvironment("GOOGLE_HOME_CLIENT_SECRET"),
  googleSsoClientId: stringEnvironment("GOOGLE_SSO_CLIENT_ID"),
  googleSsoClientSecret: stringEnvironment("GOOGLE_SSO_CLIENT_SECRET"),
  googleSsoRedirectUri: stringEnvironment("GOOGLE_SSO_REDIRECT_URI"),
  accessTokenLifetime: intEnvironment("OAUTH_ACCESS_TOKEN_EXPIRES_IN", 3600), // 1 hour
  refreshTokenLifetime: intEnvironment(
    "OAUTH_REFRESH_TOKEN_EXPIRES_IN",
    1_209_600
  ),
};
