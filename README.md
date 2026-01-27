# Homed Server Google

Google Smart Home integration server for the Homed platform, enabling Zigbee devices managed by Homed to be controlled via Google Home.

## Overview

This server implements a Google Smart Home fulfillment endpoint that connects to `homed-service-cloud` clients via encrypted TCP, translating between Homed device capabilities and Google Smart Home device types/traits.

**Architecture:**

```
Google Home → Fulfillment Server (Node.js) → TCP (encrypted) → homed-service-cloud → MQTT → Homed Devices
```

## Database

SQLite with **Drizzle ORM** (zero-config, auto-creates tables on first run). All database operations are centralized in a **repository pattern**:

- **UserRepository** — User authentication and storage
- **AuthCodeRepository** — OAuth authorization codes
- **RefreshTokenRepository** — JWT refresh token lifecycle

**No migrations needed** — tables auto-created from [src/db/schema.ts](src/db/schema.ts) on first startup.

## Prerequisites

- Node.js 25.x
- Docker & Docker Compose (for integration tests)

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment variables (see Configuration section below)
# Set required environment variables in your shell or use a tool like direnv

# Run development server (auto-initializes database)
npm run dev

# Access web UI
# Open http://localhost:8080 and sign in with your Google account

# Run tests
npm test                    # Unit tests
npm run docker:up           # Start Docker services (required for integration tests)
npm run test:integration    # Integration tests
```

## Configuration

The server is configured entirely through environment variables. You can set these in your shell, use a process manager, or use tools like `direnv` or `dotenv-cli` to load them from a file.

### Required Environment Variables

These must be set for the server to start:

#### Google OAuth Credentials (User Authentication)

Used for signing users into the web UI:

- **`GOOGLE_SSO_CLIENT_ID`** - OAuth 2.0 Client ID from Google Cloud Console
- **`GOOGLE_SSO_CLIENT_SECRET`** - OAuth 2.0 Client Secret from Google Cloud Console
- **`GOOGLE_SSO_REDIRECT_URI`** - OAuth callback URL (e.g., `http://localhost:8080/auth/google/callback`)

#### Production-Only Required Variables

When `NODE_ENV=production`, these additional variables are required:

- **`DATABASE_URL`** - SQLite database file path (e.g., `file:./prod.db`)
- **`GOOGLE_HOME_CLIENT_ID`** - Google Smart Home OAuth Client ID
- **`GOOGLE_HOME_CLIENT_SECRET`** - Google Smart Home OAuth Client Secret
- **`JWT_SECRET`** - Secret for signing JWT tokens (min 32 characters recommended)
- **`SESSION_SECRET`** - Secret for Express sessions (min 32 characters recommended)

### Optional Environment Variables

These have sensible defaults for development:

- **`NODE_ENV`** - Environment mode: `development` (default), `test`, or `production`
- **`PORT`** - HTTP server port (default: `8080`)
- **`TCP_PORT`** - TCP server port for homed-service-cloud connections (default: `8042`)
- **`DATABASE_URL`** - SQLite database path (default: `file:./prisma/dev.db` in dev/test)
- **`GOOGLE_HOME_CLIENT_ID`** - Smart Home OAuth Client ID (default: `dev-oauth-client-id` in dev/test)
- **`GOOGLE_HOME_CLIENT_SECRET`** - Smart Home OAuth Client Secret (default: `dev-oauth-client-secret` in dev/test)
- **`JWT_SECRET`** - JWT signing secret (default: `dev-jwt-secret` in dev/test)
- **`JWT_ACCESS_EXPIRES_IN`** - JWT access token lifetime (default: `1h`)
- **`JWT_REFRESH_EXPIRES_IN`** - JWT refresh token lifetime (default: `30d`)
- **`SESSION_SECRET`** - Express session secret (default: `dev-session-secret-change-in-prod` in dev/test)

### Test Environment Variables

Used in `NODE_ENV=test` mode:

- **`TEST_USERNAME`** - Auto-created test user username (default: `test`)
- **`TEST_PASSWORD`** - Auto-created test user password (default: `test`)

### Google OAuth Setup (User Authentication)

See the "Required Environment Variables" section above for the complete list of environment variables needed.

To obtain Google OAuth credentials for user authentication:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing one
3. Enable "Google+ API" or "People API"
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Configure OAuth consent screen
6. Create OAuth client ID:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:8080/auth/google/callback`
7. Set the Client ID, Client Secret, and Redirect URI as environment variables:
   - `GOOGLE_SSO_CLIENT_ID`
   - `GOOGLE_SSO_CLIENT_SECRET`
   - `GOOGLE_SSO_REDIRECT_URI`

### Development Server

```bash
npm run dev
```

### Testing

**Unit Tests:**

```bash
npm test              # Run once
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

**Integration Tests:**

```bash
# Start Docker services first
npm run docker:up

# Run integration tests
npm run test:integration
```

Integration tests run against real Docker services (MQTT broker, TCP server, Homed client). The application automatically initializes the test database on first startup.

**Docker Management:**

```bash
npm run docker:up     # Start services manually
npm run docker:down   # Stop services
npm run docker:logs   # View logs
```

### Build

```bash
npm run build
npm start
```

## Testing Architecture

Integration tests use a complete Docker environment:

```
┌──────────────┐      MQTT      ┌───────────────┐      TCP       ┌────────────┐
│ Test Code    │◄────────────-─►│ MQTT Broker   │                │ TCP Server │
│ (MQTT pub)   │                │ (Mosquitto)   │                │ (Node.js)  │
└──────────────┘                └───────────────┘                └────────────┘
                                        │                               ▲
                                        ▼                               │
                                 ┌───────────────┐                      │
                                 │ Homed Client  │──────────────────────┘
                                 │ (real binary) │
                                 └───────────────┘
```

Tests publish MQTT messages and verify they flow through the Homed client to the TCP server via encrypted connection.

## Project Structure

```
src/
├── db/               # Drizzle ORM database (schema, initialization)
├── tcp/              # TCP server with encrypted protocol (DH + AES-128-CBC)
├── services/         # Business logic (auth, device mapping, tokens)
├── routes/           # Express route handlers (OAuth, fulfillment)
├── controllers/      # Request handlers (OAuth, SmartHome)
├── middleware/       # Express middleware (auth, logging)
├── types/            # TypeScript interfaces
└── index.ts          # Entry point (auto-initializes DB)

tests/
├── unit/             # Unit tests for TCP protocol, crypto, connections
└── integration/      # Docker-based integration tests, connection flows, message routing

docker-compose.yml    # Docker services for integration testing

## API Endpoints

### OAuth 2.0

- `GET /oauth/authorize` - Authorization page
- `POST /oauth/authorize` - Process login
- `POST /oauth/token` - Token exchange

### Google Smart Home Fulfillment

- `POST /fulfillment` - Handle SYNC, QUERY, EXECUTE, DISCONNECT intents

## License

ISC
```
