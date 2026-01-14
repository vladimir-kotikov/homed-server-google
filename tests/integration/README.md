# Integration Testing Guide

This directory contains integration tests using real Homed components running in Docker.

## Architecture

```
┌─────────────────┐     MQTT      ┌──────────────┐     TCP      ┌─────────────┐
│  MQTT Publisher │◄─────────────►│ homed-client │◄────────────►│  TCP Server │
│   (Test Code)   │                │   (Docker)   │              │   (Docker)  │
└─────────────────┘                └──────────────┘              └─────────────┘
                                           │
                                           ▼
                                   ┌──────────────┐
                                   │ MQTT Broker  │
                                   │  (Mosquitto) │
                                   └──────────────┘
```

## Prerequisites

- Docker and Docker Compose
- Node.js 18+
- npm packages installed (`npm install`)

## Quick Start

### 1. Seed Test Database

Create test user and generate client configuration:

```bash
npm run seed:test
```

This creates:
- Test user in SQLite database
- `homed-cloud.conf` with authentication token

### 2. Start Docker Environment

```bash
cd tests/integration
docker-compose up -d
```

Services started:
- **mqtt** - Mosquitto MQTT broker (port 1883)
- **tcp-server** - Node.js TCP server (port 8042)
- **homed-client** - Real homed-service-cloud client

### 3. Check Service Health

```bash
# Check all services
docker-compose ps

# View logs
docker-compose logs -f

# Check specific service
docker-compose logs -f homed-client
docker-compose logs -f tcp-server
```

### 4. Run Integration Tests

```bash
# From project root
npm run test:integration

# Or run specific test
npm test -- tests/integration/tcp-client-flow.test.ts
```

## Manual Testing

### Inspect MQTT Messages

Use `mosquitto_sub` to monitor MQTT traffic:

```bash
# Subscribe to all Homed topics
docker-compose exec mqtt mosquitto_sub -v -t "homed/#"

# Monitor device states
docker-compose exec mqtt mosquitto_sub -v -t "homed/fd/#"

# Monitor status updates
docker-compose exec mqtt mosquitto_sub -v -t "homed/status/#"
```

### Publish Test Device

Use the MQTT publisher utility:

```bash
# Start Node.js shell
npm run ts-node

# In the shell:
const { MQTTPublisher, FIXTURES } = require('./tests/integration/mqtt-publisher');

const publisher = new MQTTPublisher('localhost', 1883);
await publisher.connect();

// Publish a test switch
const switchDevice = FIXTURES.switch();
await publisher.publishDevice(switchDevice, { switch: false });

// Update switch state
await publisher.publishDeviceState('zigbee', 'test-switch-001', null, { switch: true });

await publisher.disconnect();
```

### Verify TCP Connection

Check if client is connected to TCP server:

```bash
# Check TCP server logs
docker-compose logs tcp-server | grep -i "client connected"

# Check client logs
docker-compose logs homed-client | grep -i "connected"

# Check active connections
docker-compose exec tcp-server netstat -an | grep 8042
```

## Test Scenarios

### Scenario 1: Client Connection and Authentication

**Expected behavior:**
1. homed-client connects to tcp-server on port 8042
2. DH handshake completes (12 bytes → 4 bytes)
3. Client sends encrypted authorization with token
4. Server validates token against database
5. Client is authenticated and mapped to user

**Verification:**
```bash
docker-compose logs tcp-server | grep -E "handshake|auth"
```

### Scenario 2: Device Data Flow

**Expected behavior:**
1. Publish device to MQTT (`homed/status/zigbee`)
2. homed-client receives device list
3. Client forwards to tcp-server via encrypted TCP
4. Server receives subscribe message for device topics

**Test:**
```typescript
const publisher = new MQTTPublisher('localhost', 1883);
await publisher.connect();
await publisher.publishDevice(FIXTURES.light());
// Wait 2-3 seconds for propagation
// Verify TCP server received subscribe message
```

### Scenario 3: State Updates

**Expected behavior:**
1. Publish state update to `homed/fd/zigbee/device-id`
2. homed-client receives state change
3. Client forwards to tcp-server
4. Server emits message event with topic and data

**Test:**
```typescript
await publisher.publishDeviceState('zigbee', 'test-light-001', null, {
  light: true,
  level: 50
});
// Verify server received publish message
```

## Troubleshooting

### Client Won't Connect

**Check 1:** Is tcp-server listening?
```bash
docker-compose logs tcp-server | grep "listening"
```

**Check 2:** Is client token correct?
```bash
# View generated config
cat homed-cloud.conf

# Check database
sqlite3 test.db "SELECT username, clientToken FROM User;"
```

**Check 3:** Network connectivity
```bash
docker-compose exec homed-client ping tcp-server
docker-compose exec homed-client nc -zv tcp-server 8042
```

### Messages Not Routing

**Check 1:** Is MQTT broker working?
```bash
docker-compose logs mqtt
docker-compose exec mqtt mosquitto_sub -t "#" -v
```

**Check 2:** Is client subscribed to topics?
```bash
docker-compose logs homed-client | grep -i subscribe
```

**Check 3:** Check message format
```bash
# Ensure JSON is valid
docker-compose exec mqtt mosquitto_sub -t "homed/status/#" -v
```

### Authentication Failures

**Check 1:** Token mismatch
```bash
# Regenerate token
npm run seed:test

# Restart client to pick up new config
docker-compose restart homed-client
```

**Check 2:** Database not seeded
```bash
# Check if user exists
sqlite3 tests/integration/test.db "SELECT * FROM User;"
```

## Cleanup

```bash
# Stop and remove containers
docker-compose down

# Remove volumes and images
docker-compose down -v --rmi all

# Remove test database
rm test.db
```

## Configuration Files

- **docker-compose.yml** - Service orchestration
- **Dockerfile** - TCP server container
- **mosquitto.conf** - MQTT broker settings
- **homed-cloud.conf** - Client configuration (generated)
- **.env.test** - Test environment variables

## Writing New Tests

Integration tests should:
1. Use `beforeAll` to start services
2. Wait for service health checks
3. Use `MQTTPublisher` to simulate devices
4. Allow 2-3 second delays for message propagation
5. Clean up in `afterAll`

Example:
```typescript
describe('Device Integration', () => {
  let publisher: MQTTPublisher;

  beforeAll(async () => {
    publisher = new MQTTPublisher('localhost', 1883);
    await publisher.connect();
  });

  afterAll(async () => {
    await publisher.disconnect();
  });

  it('should route device state updates', async () => {
    // Publish device
    await publisher.publishDevice(FIXTURES.switch());

    // Wait for propagation
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Assert TCP server received message
    // ... verification logic
  });
});
```
