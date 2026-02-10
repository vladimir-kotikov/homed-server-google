/**
 * Unified test setup file for all unit and integration tests
 * This runs BEFORE any test files are imported, ensuring environment variables
 * are set before appConfig module is evaluated
 *
 * We clear and reseed process.env to avoid any environment leakage from the
 * host system (e.g., CI environment), ensuring tests run in isolation
 */

// Clear all existing environment variables except those needed for Node.js
const nodeEnvVars = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USER: process.env.USER,
  SHELL: process.env.SHELL,
  TERM: process.env.TERM,
  // Preserve any Node-specific or critical system variables
  ...(process.env.NODE_DEBUG ? { NODE_DEBUG: process.env.NODE_DEBUG } : {}),
};

// Reset process.env to clean state
for (const key in process.env) {
  delete process.env[key];
}

// Restore only necessary system variables
Object.assign(process.env, nodeEnvVars);

// Now set test-specific environment variables
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

// Google Home Graph API credentials (for unit tests)
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/credentials.json";
