# Homed Server Google

Google Smart Home integration server for the Homed platform, enabling Zigbee devices managed by Homed to be controlled via Google Home.

## Overview

This server implements a Google Smart Home fulfillment endpoint that connects to `homed-service-cloud` clients via encrypted TCP, translating between Homed device capabilities and Google Smart Home device types/traits.

**Architecture:**

```
Google Home → Fulfillment Server (Node.js) → TCP (encrypted) → homed-service-cloud → MQTT → Homed Devices
```

## Prerequisites

- Node.js 18+
- Docker & Docker Compose (for integration tests)

## Quick Start

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run development server (auto-initializes database)
npm run dev

# Run tests
npm test                    # Unit tests
npm run docker:up           # Start Docker services (required for integration tests)
npm run test:integration    # Integration tests
```

## Development

### Configuration

Copy `.env.example` to `.env` and adjust as needed. The application auto-initializes the database on first startup.

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
┌──────────────┐     MQTT      ┌───────────────┐     TCP       ┌────────────┐
│ Test Code    │◄─────────────►│ MQTT Broker   │               │ TCP Server │
│ (MQTT pub)   │                │ (Mosquitto)   │               │ (Node.js)  │
└──────────────┘                └───────────────┘               └────────────┘
                                        │                              ▲
                                        ▼                              │
                                ┌───────────────┐                      │
                                │ Homed Client  │──────────────────────┘
                                │ (real binary) │
                                └───────────────┘
```

Tests publish MQTT messages and verify they flow through the Homed client to the TCP server via encrypted connection.

## Project Structure

```
src/
├── tcp/              # TCP server with encrypted protocol (DH + AES-128-CBC)
├── services/         # Business logic (auth, device mapping)
├── types/           # TypeScript interfaces
└── index.ts         # Entry point (auto-initializes DB)

tests/
├── unit/            # Unit tests for TCP protocol, crypto, connections
└── integration/     # Docker-based integration tests, connection flows, message routing

docker-compose.yml   # Docker services for integration testing

## API Endpoints

### OAuth 2.0

- `GET /oauth/authorize` - Authorization page
- `POST /oauth/authorize` - Process login
- `POST /oauth/token` - Token exchange

### Google Smart Home Fulfillment

- `POST /fulfillment` - Handle SYNC, QUERY, EXECUTE, DISCONNECT intents

## License

ISC
