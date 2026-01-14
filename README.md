# Homed Server Google

Google Smart Home integration server for the Homed platform, enabling Zigbee devices managed by Homed to be controlled via Google Home.

## Overview

This server implements a Google Smart Home fulfillment endpoint that connects to `homed-service-cloud` clients via TCP, translating between Homed device capabilities and Google Smart Home device types/traits.

**Architecture:**

```
Google Home → Fulfillment Server (Node.js) → TCP Connection → homed-service-cloud → MQTT → Homed Devices
```

## Prerequisites

- Node.js 18+
- SQLite 3
- homed-service-cloud client (<https://github.com/u236/homed-service-cloud>)
- Google Actions Console project with Smart Home action configured
- Service account with Home Graph API access

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

- Database path
- Server ports (HTTP: 8080, TCP: 8042)
- OAuth credentials from Google Actions Console
- JWT secret
- Google service account credentials path

### 3. Set Up Database

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 4. Add Service Account Key

Place your Google service account JSON key in `keys/service-account.json`.

### 5. Create User

Create a user account with client token for homed-service-cloud to connect:

```bash
npm run seed:test
```

This will output a username, password, and client token.

## Development

### Run Development Server

```bash
npm run dev
```

### Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
/
├── src/
│   ├── controllers/      # HTTP request handlers
│   ├── services/         # Business logic
│   ├── tcp/             # TCP server and protocol implementation
│   ├── routes/          # Express routes
│   ├── middleware/      # Express middleware
│   ├── types/           # TypeScript interfaces
│   ├── config/          # Configuration
│   └── index.ts         # Application entry point
├── tests/
│   ├── unit/            # Unit tests
│   └── integration/     # Integration tests
├── prisma/
│   └── schema.prisma    # Database schema
└── keys/
    └── service-account.json  # Google service account key
```

## Testing with homed-service-cloud

See `tests/integration/test-client-setup.md` for detailed instructions on testing with a real homed-service-cloud client.

## API Endpoints

### OAuth 2.0

- `GET /oauth/authorize` - Authorization page
- `POST /oauth/authorize` - Process login
- `POST /oauth/token` - Token exchange

### Google Smart Home Fulfillment

- `POST /fulfillment` - Handle SYNC, QUERY, EXECUTE, DISCONNECT intents

## License

ISC
