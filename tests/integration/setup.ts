/**
 * Setup file for integration tests
 * This runs BEFORE any test files are imported, ensuring environment variables
 * are set before appConfig module is evaluated
 */

// Set common test environment variables
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.COOKIE_SECRET = "test-cookie-secret";
process.env.SENTRY_DSN = "";

// OAuth credentials - must match test constants
process.env.JWT_SECRET = "test-oauth-secret";
process.env.GOOGLE_HOME_CLIENT_ID = "dev-oauth-client-id";
process.env.GOOGLE_HOME_CLIENT_SECRET = "dev-oauth-client-secret";
process.env.GOOGLE_HOME_PROJECT_ID = "project-id";

// Google SSO credentials (not used in tests but required by config)
process.env.GOOGLE_SSO_CLIENT_ID = "test-sso-client-id";
process.env.GOOGLE_SSO_CLIENT_SECRET = "test-sso-client-secret";
process.env.GOOGLE_SSO_REDIRECT_URI =
  "http://localhost:8080/auth/google/callback";
