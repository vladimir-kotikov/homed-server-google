# Implementation Plan: Google Smart Home Server for Homed

## Project Overview

This project implements a Google Smart Home integration server for the Homed platform, enabling Zigbee devices managed by Homed to be controlled via Google Home. The implementation mirrors the existing Yandex Cloud integration architecture but targets Google's Smart Home API.

### Context

- **Homed Platform**: Custom hardware with Zigbee USB stick using Homed (<https://wiki.homed.dev/>) as integration platform
- **Existing Integration**: Yandex Cloud integration at <https://github.com/u236/homed-service-cloud> (client) and <https://github.com/u236/homed-server-cloud> (server)
- **Goal**: Create equivalent functionality for Google Home while maintaining compatibility with existing homed-service-cloud client

## Technical Stack

### Core Technologies

- **Runtime**: Node.js 18+ with TypeScript 5.x
- **Web Framework**: Express.js 4.x
- **Database**: SQLite with Prisma ORM
- **Testing**: Jest with ts-jest
- **Authentication**: jsonwebtoken, bcrypt

### Google Integration

- **google-auth-library**: Service account JWT authentication
- **googleapis**: Home Graph API client

### Protocol Implementation

- **Node.js crypto module**: DH key exchange, AES-128-CBC encryption, MD5 hashing
- **Node.js net module**: TCP server for client connections

## Architecture Overview

### Two-Component Architecture

```
Google Home → Fulfillment Server (Node.js) → TCP Connection → homed-service-cloud → MQTT → Homed Devices
```

**Components:**

1. **Google Fulfillment Server** (this project)
   - Express.js HTTP server for OAuth 2.0 and fulfillment endpoints
   - TCP server accepting connections from homed-service-cloud clients
   - SQLite database for user credentials and device state
   - Home Graph API integration for state reporting

2. **Homed Service Cloud** (existing, reused)
   - C++/Qt client service running on user's local network
   - Connects to fulfillment server via TCP
   - Communicates with local Homed via MQTT
   - Will be configured to connect to the new Google server

### Authentication Protocol

**TCP Handshake (Homed-compatible):**

1. **Client connects** to TCP server
2. **Client sends** 12-byte handshake: `{prime: uint32, generator: uint32, sharedKey: uint32}` (big-endian)
3. **Server generates** DH parameters, computes shared key
4. **Server responds** with 4-byte uint32 (server's shared key, big-endian)
5. **Both sides derive** AES key: `MD5(privateKey)`, IV: `MD5(AES_key)`
6. **Client sends** encrypted JSON: `{uniqueId: string, token: string}`
7. **Server validates** token against database, maps client to user

**Binary Message Protocol:**

- Start marker: `0x42`
- End marker: `0x43`
- Escape marker: `0x44` (escapes `0x42→0x44,0x62`, `0x43→0x44,0x63`, `0x44→0x44,0x64`)
- Payload: AES-128-CBC encrypted JSON (16-byte padded)

**JSON Message Format:**

```json
{
  "action": "subscribe|publish",
  "topic": "status/#|device/...|expose/...|fd/...|td/...",
  "message": {...}
}
```

## Implementation Steps

---

## Step 1: Project Initialization & Testing Infrastructure

### Objectives

Set up the Node.js/TypeScript project with proper tooling, testing infrastructure, and basic project structure.

### Deliverables

1. **package.json** with dependencies:

   ```json
   {
     "dependencies": {
       "express": "^4.18.2",
       "google-auth-library": "^9.0.0",
       "googleapis": "^126.0.0",
       "jsonwebtoken": "^9.0.2",
       "bcrypt": "^5.1.1",
       "@prisma/client": "^5.0.0",
       "dotenv": "^16.3.1"
     },
     "devDependencies": {
       "typescript": "^5.2.2",
       "ts-node": "^10.9.1",
       "@types/node": "^20.8.0",
       "@types/express": "^4.17.20",
       "@types/jsonwebtoken": "^9.0.4",
       "@types/bcrypt": "^5.0.1",
       "jest": "^29.7.0",
       "ts-jest": "^29.1.1",
       "@types/jest": "^29.5.5",
       "nodemon": "^3.0.1",
       "prisma": "^5.0.0"
     }
   }
   ```

2. **tsconfig.json** - TypeScript configuration
3. **jest.config.js** - Jest configuration with ts-jest
4. **.env.example** - Environment variables template
5. **Directory structure**:

   ```
   /
   ├── src/
   │   ├── controllers/
   │   ├── services/
   │   ├── tcp/
   │   ├── routes/
   │   ├── middleware/
   │   ├── types/
   │   ├── config/
   │   └── index.ts
   ├── tests/
   │   ├── unit/
   │   └── integration/
   ├── prisma/
   │   └── schema.prisma
   └── keys/
       └── .gitkeep
   ```

6. **prisma/schema.prisma** - Database schema:

   ```prisma
   datasource db {
     provider = "sqlite"
     url      = env("DATABASE_URL")
   }

   generator client {
     provider = "prisma-client-js"
   }

   model User {
     id            String   @id @default(uuid())
     username      String   @unique
     passwordHash  String
     clientToken   String   @unique  // hex string
     createdAt     DateTime @default(now())

     authCodes     AuthCode[]
     refreshTokens RefreshToken[]
   }

   model AuthCode {
     id        String   @id @default(uuid())
     code      String   @unique
     userId    String
     user      User     @relation(fields: [userId], references: [id])
     expiresAt DateTime
     used      Boolean  @default(false)
     createdAt DateTime @default(now())
   }

   model RefreshToken {
     id        String   @id @default(uuid())
     token     String   @unique
     userId    String
     user      User     @relation(fields: [userId], references: [id])
     expiresAt DateTime
     createdAt DateTime @default(now())
   }
   ```

7. **src/types/index.ts** - TypeScript interfaces for Google Smart Home API
8. **README.md** - Project documentation with setup instructions

### Testing Requirements

- Jest configured and running with `npm test`
- Sample test file `tests/unit/example.test.ts` passing
- TypeScript compilation successful with `npm run build`

### Success Criteria

- [x] All dependencies installed without errors
- [x] TypeScript compiles without errors
- [x] Jest runs and sample tests pass
- [x] Prisma generates client successfully
- [x] Project structure matches specification
- [x] README documents setup and run instructions

---

## Step 2: TCP Server with Homed Protocol

### Objectives

Implement TCP server that accepts connections from homed-service-cloud clients using the exact protocol (DH key exchange, AES-128-CBC encryption, binary framing).

### Deliverables

1. **src/tcp/crypto.ts** - Cryptographic utilities:

   ```typescript
   export class DHKeyExchange {
     // Diffie-Hellman key exchange using Node.js crypto
     generateParameters(): {
       prime: number;
       generator: number;
       sharedKey: number;
     };
     computePrivateKey(clientSharedKey: number): number;
   }

   export class AES128CBC {
     // AES-128 CBC encryption/decryption
     constructor(key: Buffer, iv: Buffer);
     encrypt(data: Buffer): Buffer;
     decrypt(data: Buffer): Buffer;
   }

   export function deriveMD5Key(privateKey: number): Buffer;
   ```

2. **src/tcp/protocol.ts** - Binary protocol handling:

   ```typescript
   export class MessageFramer {
     // Frame/unframe messages with 0x42/0x43/0x44 protocol
     frame(data: Buffer): Buffer;
     unframe(buffer: Buffer): Buffer[];
   }

   export interface ProtocolMessage {
     action: "subscribe" | "publish";
     topic: string;
     message?: any;
   }
   ```

3. **src/tcp/client-connection.ts** - Individual client connection handler:

   ```typescript
   export class ClientConnection extends EventEmitter {
     constructor(socket: Socket);

     // Lifecycle
     handleHandshake(): Promise<void>;
     handleAuthorization(message: ProtocolMessage): Promise<void>;
     sendMessage(message: ProtocolMessage): void;

     // State
     isAuthenticated(): boolean;
     getUserId(): string | null;
     getUniqueId(): string | null;
   }
   ```

4. **src/tcp/server.ts** - TCP server:

   ```typescript
   export class TCPServer extends EventEmitter {
     constructor(port: number);

     start(): Promise<void>;
     stop(): Promise<void>;

     // Client management
     getClientsByUser(userId: string): ClientConnection[];
     disconnectClient(uniqueId: string): void;

     // Message routing
     broadcastToUser(userId: string, message: ProtocolMessage): void;
   }
   ```

5. **src/services/auth.service.ts** - Authentication service:

   ```typescript
   export class AuthService {
     validateClientToken(token: string): Promise<User | null>;
     createUser(username: string, password: string): Promise<User>;
     validateUserCredentials(
       username: string,
       password: string
     ): Promise<User | null>;
   }
   ```

### Testing Requirements

1. **tests/unit/tcp-protocol.test.ts**:
   - Test message framing/unframing
   - Test escape sequences
   - Test buffer handling edge cases

2. **tests/unit/client-connection.test.ts**:
   - Mock socket connection
   - Test handshake flow
   - Test authorization with valid/invalid tokens
   - Test message encryption/decryption

3. **tests/unit/tcp-server.test.ts**:
   - Test server startup/shutdown
   - Test client connection handling
   - Test client-to-user mapping
   - Test message routing to specific users

### Integration Test Setup

**tests/integration/test-client-setup.md**:

````markdown
# Testing with Real homed-service-cloud Client

## Prerequisites

- homed-service-cloud built from https://github.com/u236/homed-service-cloud
- MQTT broker running (mosquitto)
- Test user created in database

## Configuration

Create test config at `/tmp/homed-cloud-test.conf`:

```ini
[cloud]
uniqueid = test-client-001
token = <clientToken from database>
host = localhost
port = 8042

[mqtt]
host = localhost
port = 1883
```
````

---

## Step 3: OAuth 2.0 & Fulfillment Endpoints

### Objectives

Implement OAuth 2.0 authorization flow and Google Smart Home fulfillment endpoint handling SYNC, QUERY, EXECUTE, and DISCONNECT intents.

### Deliverables

1. **src/controllers/oauth.controller.ts**:

   ```typescript
   export class OAuthController {
     // GET /oauth/authorize - Show login page
     authorize(req, res): Promise<void>;

     // POST /oauth/authorize - Process login, generate auth code
     handleLogin(req, res): Promise<void>;

     // POST /oauth/token - Exchange code for tokens
     token(req, res): Promise<void>;
   }
   ```

1. **src/controllers/smarthome.controller.ts**:

   ```typescript
   export class SmartHomeController {
     // POST /fulfillment - Handle all Google Smart Home intents
     handleIntent(req, res): Promise<void>;

     private handleSync(request: SyncRequest): Promise<SyncResponse>;
     private handleQuery(request: QueryRequest): Promise<QueryResponse>;
     private handleExecute(request: ExecuteRequest): Promise<ExecuteResponse>;
     private handleDisconnect(
       request: DisconnectRequest
     ): Promise<DisconnectResponse>;
   }
   ```

1. **src/services/device.service.ts**:

   ```typescript
   export class DeviceService {
     // Get all devices for a user from connected TCP clients
     getDevicesForUser(userId: string): Promise<GoogleDevice[]>;

     // Query device states
     queryDeviceStates(
       userId: string,
       deviceIds: string[]
     ): Promise<DeviceState[]>;

     // Execute command on device
     executeCommand(
       userId: string,
       deviceId: string,
       command: Command
     ): Promise<ExecuteResult>;
   }
   ```

1. **src/middleware/auth.middleware.ts**:

   ```typescript
   export function authenticateToken(req, res, next): void;
   export function validateOAuthRequest(req, res, next): void;
   ```

1. **src/routes/oauth.routes.ts** - OAuth routes
1. **src/routes/smarthome.routes.ts** - Fulfillment routes
1. **public/login.html** - Login page for OAuth

1. **src/types/google-smarthome.ts** - Complete TypeScript interfaces:

   ```typescript
   export interface SyncRequest {
     requestId: string;
     inputs: [{ intent: "action.devices.SYNC" }];
   }

   export interface SyncResponse {
     requestId: string;
     payload: {
       agentUserId: string;
       devices: GoogleDevice[];
     };
   }

   export interface GoogleDevice {
     id: string;
     type: string;
     traits: string[];
     name: {
       defaultNames: string[];
       name: string;
       nicknames: string[];
     };
     willReportState: boolean;
     attributes?: Record<string, any>;
     deviceInfo?: {
       manufacturer: string;
       model: string;
       hwVersion: string;
       swVersion: string;
     };
   }

   // ... additional interfaces for QUERY, EXECUTE, DISCONNECT
   ```

### Testing Requirements

1. **tests/unit/oauth.controller.test.ts**:
   - Test authorization endpoint
   - Test token generation
   - Test token refresh
   - Test invalid credentials handling

2. **tests/unit/smarthome.controller.test.ts**:
   - Mock TCP server and device service
   - Test SYNC intent with multiple devices
   - Test QUERY intent with online/offline devices
   - Test EXECUTE intent success/failure
   - Test DISCONNECT intent

3. **tests/unit/device.service.test.ts**:
   - Test device aggregation from TCP clients
   - Test state querying
   - Test command execution

### Integration Test

**tests/integration/oauth-flow.test.ts**:

- Full OAuth flow with actual HTTP requests
- Token generation and validation
- Token refresh

### Success Criteria

- [x] OAuth authorization page displays
- [x] Login with valid credentials generates auth code
- [x] Token endpoint exchanges code for access/refresh tokens
- [x] SYNC intent returns devices from connected TCP clients
- [x] QUERY intent returns device states
- [x] EXECUTE intent forwards commands to TCP clients
- [x] All endpoints return proper error codes
- [x] Unit tests pass with 80%+ coverage
- [x] **36/36 OAuth tests passing**
- [x] **21/21 fulfillment tests passing**

**Status:** ✅ **COMPLETE** (January 15, 2026)

---

## Step 4: Capability Mapping System

### Objectives

Create a comprehensive, testable mapping system that translates Homed device capabilities to Google Smart Home device types and traits.

### Reference implementation

Server implementation for Yandex cloud: <https://github.com/u236/homed-server-cloud>, specifically:

- capability.cpp and capability.h
- controller.cpp and controller.h

Shared library with Endpoint and Expose models: <https://github.com/u236/homed-service-common>, specifically:

- endpoint.h
- expose.h

### Deliverables

1. **src/services/mapper.service.ts**:

   ```typescript
   export interface HomedDevice {
     key: string;
     topic: string;
     name: string;
     description: string;
     available: boolean;
     endpoints: HomedEndpoint[];
   }

   export interface HomedEndpoint {
     id: number;
     type: string;
     exposes: string[];
     options: Record<string, any>;
   }

   export class CapabilityMapper {
     // Convert Homed device to Google device
     mapToGoogleDevice(
       homedDevice: HomedDevice,
       clientId: string
     ): GoogleDevice;

     // Convert Homed state to Google state
     mapToGoogleState(homedDevice: HomedDevice): Record<string, any>;

     // Convert Google command to Homed command
     mapToHomedCommand(command: GoogleCommand): HomedCommand;
   }
   ```

2. **src/services/mapper/traits.ts** - Trait mapping logic:

   ```typescript
   export interface TraitMapper {
     // Determine if Homed device supports this trait
     supports(endpoint: HomedEndpoint): boolean;

     // Get trait attributes for SYNC
     getAttributes(endpoint: HomedEndpoint): Record<string, any>;

     // Get trait state for QUERY
     getState(data: Record<string, any>): Record<string, any>;

     // Convert Google command to Homed action
     getAction(command: GoogleCommand): HomedCommand;
   }

   export const OnOffTrait: TraitMapper;
   export const BrightnessTrait: TraitMapper;
   export const ColorSettingTrait: TraitMapper;
   export const OpenCloseTrait: TraitMapper;
   export const TemperatureSettingTrait: TraitMapper;
   // ... other traits
   ```

3. **src/services/mapper/device-types.ts** - Device type mapping:

   ```typescript
   export const DEVICE_TYPE_MAPPINGS = {
     switch: "action.devices.types.SWITCH",
     outlet: "action.devices.types.OUTLET",
     light: "action.devices.types.LIGHT",
     curtain: "action.devices.types.BLINDS",
     thermostat: "action.devices.types.THERMOSTAT",
     door_lock: "action.devices.types.LOCK",
     // ... sensors
   };
   ```

4. **Mapping Configuration** based on Yandex implementation:

   | Homed Expose  | Google Device Type | Google Traits                        |
   | ------------- | ------------------ | ------------------------------------ |
   | `switch`      | SWITCH or OUTLET   | OnOff                                |
   | `lock`        | LOCK               | LockUnlock                           |
   | `light`       | LIGHT              | OnOff, [Brightness], [ColorSetting]  |
   | `cover`       | BLINDS             | OpenClose                            |
   | `thermostat`  | THERMOSTAT         | TemperatureSetting, [ThermostatMode] |
   | `contact`     | SENSOR             | SensorState (openClose)              |
   | `occupancy`   | SENSOR             | SensorState (occupancy)              |
   | `smoke`       | SMOKE_DETECTOR     | SensorState (smokeLevel)             |
   | `waterLeak`   | SENSOR             | SensorState (waterLeak)              |
   | `temperature` | SENSOR             | TemperatureControl                   |
   | `humidity`    | SENSOR             | HumiditySetting                      |

### Testing Requirements

**tests/unit/mapper.test.ts** - Comprehensive test cases:

1. **Switch Device**:

   ```typescript
   it("maps switch to SWITCH with OnOff trait", () => {
     const homed = {
       exposes: ["switch"],
       options: {},
     };
     const google = mapper.map(homed);
     expect(google.type).toBe("action.devices.types.SWITCH");
     expect(google.traits).toContain("action.devices.traits.OnOff");
   });
   ```

2. **Light Device**:
   - Simple on/off light
   - Dimmable light (with level)
   - Color light (with color/colorTemperature)
   - Full-featured light (all options)

3. **Thermostat Device**:
   - Temperature control
   - Mode switching
   - Power on/off

4. **Cover Device**:
   - Position control
   - Open/close commands

5. **Sensors**:
   - Binary sensors (contact, occupancy, smoke, waterLeak)
   - Numeric sensors (temperature, humidity, pressure)

6. **State Mapping**:
   - Homed state → Google state
   - Google command → Homed topic/message

7. **Edge Cases**:
   - Missing exposes
   - Invalid options
   - Multiple endpoints
   - Device offline/unavailable

### Success Criteria

- [x] All Homed device types map to correct Google types
- [x] All traits have correct attributes
- [x] State conversions are bidirectional
- [x] Commands map to correct Homed topics/messages
- [x] 100% test coverage for mapper
- [x] All test cases pass

---

## Step 5: Google Home Graph API Integration

### Objectives

Integrate with Google Home Graph API for reporting device state changes and requesting device sync.

### Deliverables

1. **src/services/homegraph.service.ts**:

   ```typescript
   export class HomeGraphService {
     constructor(serviceAccountPath: string);

     // Report device state to Google
     async reportState(
       userId: string,
       deviceId: string,
       state: Record<string, any>
     ): Promise<void>;

     // Report multiple device states
     async reportStates(
       userId: string,
       states: Record<string, any>
     ): Promise<void>;

     // Request sync for user's devices
     async requestSync(userId: string): Promise<void>;
   }
   ```

2. **src/config/google.config.ts**:

   ```typescript
   export interface GoogleConfig {
     serviceAccountPath: string;
     projectId: string;
   }

   export function loadGoogleConfig(): GoogleConfig;
   ```

3. **keys/service-account.json.example** - Template for service account key

4. **src/tcp/event-handlers.ts** - TCP message event handlers:

   ```typescript
   export class TCPEventHandler {
     constructor(
       private tcpServer: TCPServer,
       private homeGraph: HomeGraphService,
       private mapper: CapabilityMapper
     );

     // Handle device state updates from "fd/" topic
     onDeviceStateUpdate(client: ClientConnection, message: ProtocolMessage): void;

     // Handle device list updates from "status/" topic
     onDeviceListUpdate(client: ClientConnection, message: ProtocolMessage): void;

     // Handle device capability updates from "expose/" topic
     onDeviceExposesUpdate(client: ClientConnection, message: ProtocolMessage): void;
   }
   ```

5. **Error Mapping** in src/services/error.service.ts:

   ```typescript
   export enum GoogleErrorCode {
     DEVICE_NOT_FOUND = "deviceNotFound",
     DEVICE_OFFLINE = "deviceOffline",
     DEVICE_NOT_READY = "deviceNotReady",
     AUTH_FAILURE = "authFailure",
     TRANSIENT_ERROR = "transientError",
     PROTOCOL_ERROR = "protocolError",
   }

   export function mapToGoogleError(error: Error): GoogleErrorCode;
   ```

### Testing Requirements

1. **tests/unit/homegraph.service.test.ts**:
   - Mock googleapis Home Graph API
   - Test reportState success
   - Test reportState with API errors
   - Test requestSync success
   - Test service account authentication

2. **tests/unit/event-handlers.test.ts**:
   - Mock TCP server and Home Graph service
   - Test state update triggers reportState
   - Test device list update triggers requestSync
   - Test state changes are correctly mapped
   - Test offline devices don't trigger reports

3. **tests/unit/error.service.test.ts**:
   - Test error code mapping
   - Test error response formatting

### Mock Implementation

**src/services/homegraph.mock.ts**:

```typescript
export class MockHomeGraphService extends HomeGraphService {
  public reportedStates: Array<{ userId: string; states: any }> = [];
  public syncRequests: string[] = [];

  async reportState(
    userId: string,
    deviceId: string,
    state: any
  ): Promise<void> {
    this.reportedStates.push({ userId, states: { [deviceId]: state } });
  }

  async requestSync(userId: string): Promise<void> {
    this.syncRequests.push(userId);
  }
}
```

### Documentation

**docs/google-setup.md**:

- How to create Google Actions project
- How to configure Smart Home action
- How to generate service account key
- How to enable Home Graph API
- OAuth configuration in Actions Console

### Success Criteria

- [x] Service account authentication works
- [x] reportState successfully sends to Google API (or mock)
- [x] requestSync successfully triggers device sync
- [x] TCP state updates trigger reportState
- [x] Device topology changes trigger requestSync
- [x] Error codes properly mapped
- [x] Unit tests pass with mocked API
- [x] Documentation complete

---

## Step 6: Integration Test Environment

### Objectives

Create a complete integration test setup allowing manual testing with real homed-service-cloud client, MQTT broker, and simulated or real Homed devices.

### Deliverables

1. **tests/integration/docker-compose.yml**:

   ```yaml
   version: "3.8"
   services:
     mqtt:
       image: eclipse-mosquitto:latest
       ports:
         - "1883:1883"
       volumes:
         - ./mosquitto.conf:/mosquitto/config/mosquitto.conf

     server:
       build: ../..
       ports:
         - "8042:8042" # TCP
         - "3000:3000" # HTTP
       environment:
         - DATABASE_URL=file:./test.db
         - TCP_PORT=8042
         - HTTP_PORT=3000
       depends_on:
         - mqtt
   ```

2. **tests/integration/mosquitto.conf** - MQTT broker config

3. **tests/integration/seed-test-data.ts**:

   ```typescript
   export async function seedTestData() {
     const prisma = new PrismaClient();

     // Create test user
     const user = await prisma.user.create({
       data: {
         username: "test-user",
         passwordHash: await bcrypt.hash("test-password", 10),
         clientToken: "deadbeefcafe...", // Known token for client
       },
     });

     console.log("Test user created:", user);
     console.log("Client token:", user.clientToken);
   }
   ```

4. **tests/integration/example-config.conf** - homed-service-cloud config:

   ```ini
   [cloud]
   uniqueid = integration-test-client
   token = <from seed-test-data output>
   host = localhost
   port = 8042

   [mqtt]
   host = localhost
   port = 1883
   prefix = homed
   ```

5. **tests/integration/simulate-devices.ts** - MQTT device simulator:

   ```typescript
   // Publishes test device data to MQTT topics
   export class DeviceSimulator {
     publishDeviceStatus(service: string, devices: Device[]): void;
     publishDeviceExposes(
       service: string,
       device: Device,
       exposes: Expose[]
     ): void;
     publishDeviceState(service: string, device: Device, state: any): void;
     simulateTemperatureSensor(): void;
     simulateLightDevice(): void;
   }
   ```

6. **tests/integration/README.md** - Complete test guide:

   ```markdown
   # Integration Testing Guide

   ## Quick Start

   1. Start services: `docker-compose up -d`
   2. Seed test data: `npm run seed:test`
   3. Run homed-service-cloud client
   4. Simulate devices: `npm run simulate:devices`
   5. Test OAuth flow in browser
   6. Test Google Home fulfillment with curl/Postman

   ## Test Scenarios

   - Device discovery (SYNC)
   - State query (QUERY)
   - Command execution (EXECUTE)
   - State reporting
   - Device online/offline
   - OAuth flow
   ```

7. **tests/integration/test-scenarios/** - Manual test scripts:
   - `01-oauth-flow.sh` - Test OAuth authorization
   - `02-sync-intent.sh` - Test device discovery
   - `03-query-intent.sh` - Test state query
   - `04-execute-intent.sh` - Test command execution
   - `05-state-reporting.sh` - Verify state reports

### Testing Requirements

1. **End-to-End Test Scenario**:
   - Start all services (MQTT, server, client)
   - Simulate device appearing in Homed
   - Verify SYNC returns device
   - Send EXECUTE command to turn on light
   - Verify command received by simulator
   - Simulate state change
   - Verify reportState called

2. **Manual Testing Checklist**:
   - [ ] TCP client connects successfully
   - [ ] Client authenticates with token
   - [ ] Device list received from MQTT
   - [ ] Device exposes parsed correctly
   - [ ] OAuth login page loads
   - [ ] Login succeeds with test credentials
   - [ ] Auth code generated
   - [ ] Token exchange succeeds
   - [ ] SYNC intent returns devices
   - [ ] QUERY intent returns states
   - [ ] EXECUTE intent controls device
   - [ ] State changes reported to Google
   - [ ] Device offline handled gracefully

### CI/CD Setup

**github/workflows/test.yml**:

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run test:integration
```

### Success Criteria

- [x] Docker Compose starts all services
- [x] Test data seeds successfully
- [x] Real homed-service-cloud client connects
- [x] Device simulator publishes valid MQTT data
- [x] Full OAuth → SYNC → QUERY → EXECUTE flow works
- [x] State changes trigger reportState
- [x] All manual test scenarios pass
- [x] Integration tests automated where possible
- [x] Documentation complete and accurate

---

## Technical References

### Homed Protocol Implementation

[HOMED_TCP_PROTOCOL.md](./docs/HOMED_TCP_PROTOCOL.md)

### Google Smart Home API References

- **Actions Console**: <https://console.actions.google.com/>
- **Smart Home Documentation**: <https://developers.google.com/assistant/smarthome>
- **Home Graph API**: <https://developers.google.com/assistant/smarthome/develop/home-graph>
- **Device Types**: <https://developers.google.com/assistant/smarthome/guides>
- **Traits Reference**: <https://developers.google.com/assistant/smarthome/traits>

### Homed Platform

- **Wiki**: <https://wiki.homed.dev/>
- **Service Cloud (Client)**: <https://github.com/u236/homed-service-cloud>
- **Server Cloud (Yandex)**: <https://github.com/u236/homed-server-cloud>

---

## Testing Strategy

### Unit Tests (Jest)

- **Coverage Target**: 80%+ overall
- **Focus Areas**:
  - Protocol handling (framing, encryption)
  - Capability mapping (all device types)
  - OAuth flow logic
  - Error handling
  - State transformations

### Integration Tests

- **Manual Testing**: With real homed-service-cloud client
- **Docker Compose**: Isolated test environment
- **MQTT Simulator**: Synthetic device data
- **Test Scenarios**: Complete user flows

### Test Data

- **Fixtures**: Sample Homed devices in tests/fixtures/
- **Mocks**: Google API responses
- **Stubs**: Service account authentication

---

## Notes

### Development Workflow

For each step:

1. Implement code
2. Write unit tests (TDD where possible)
3. Verify tests pass
4. Test manually if applicable
5. Update documentation
6. Review and refactor
7. Commit and mark step complete

### Dependencies Between Steps

- Step 1 → Step 2: Project setup required
- Step 2 → Step 3: TCP server needed for device service
- Step 3 → Step 4: Fulfillment endpoints need mapper
- Step 4 → Step 5: Mapper needed for state reporting
- Step 5 → Step 6: All components needed for integration

Each step should be completable independently once dependencies are satisfied.

### Future Enhancements (Out of Scope)

- Telegram bot integration for user management
- Multiple server instances with load balancing
- WebSocket alternative to TCP
- Redis for distributed state management
- Prometheus metrics and monitoring
- Rate limiting and abuse prevention
