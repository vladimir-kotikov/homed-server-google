# Integration Testing Quick Start

## Overview

Complete Docker-based integration testing environment for homed-server-google with real homed-service-cloud client and MQTT broker.

## Prerequisites

✅ Docker Desktop or Docker Engine installed
✅ Docker Compose v2.0+
✅ Node.js 18+
✅ Dependencies installed (`npm install`)

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

This installs the MQTT client library needed for tests.

### 2. Generate Test Database and Configuration

```bash
npm run seed:test
```

**Output:**
```
🌱 Seeding test data...
✅ Test user created:
   Username: test-user
   Password: test-password
   Client Token: a1b2c3d4e5f6...
   User ID: uuid-here
✅ Client configuration written to: tests/integration/homed-cloud.conf

📋 Next steps:
   1. Start integration environment: docker-compose up -d
   2. Check logs: docker-compose logs -f
   3. Run integration tests: npm run test:integration
```

**This creates:**
- `tests/integration/test.db` - SQLite database with test user
- `tests/integration/homed-cloud.conf` - Client configuration with auth token

### 3. Start Docker Environment

```bash
npm run docker:up
```

**Or manually:**
```bash
cd tests/integration
docker-compose up -d
cd ../..
```

**Services started:**
- `mqtt` - Mosquitto MQTT broker on port 1883
- `tcp-server` - Your Node.js server on ports 8042 (TCP) and 8080 (HTTP)
- `homed-client` - Real homed-service-cloud client

### 4. Verify Services are Running

```bash
npm run docker:logs
```

**Check for:**
- ✅ MQTT broker: `mosquitto version X.X running`
- ✅ TCP server: `listening on port 8042`
- ✅ Homed client: `connected` or similar success message

### 5. Run Integration Tests

```bash
npm run test:integration
```

**Tests will:**
1. Connect MQTT publisher
2. Simulate device data on MQTT topics
3. Verify data flows through client to TCP server
4. Test various scenarios (device discovery, state updates, etc.)

## Manual Testing

### Monitor MQTT Traffic

```bash
# All topics
docker exec homed-test-mqtt mosquitto_sub -v -t "homed/#"

# Device states only
docker exec homed-test-mqtt mosquitto_sub -v -t "homed/fd/#"

# Status updates only
docker exec homed-test-mqtt mosquitto_sub -v -t "homed/status/#"
```

### Publish Test Device

```bash
# From project root
npm run ts-node

# In Node.js REPL:
const { MQTTPublisher, FIXTURES } = require('./tests/integration/mqtt-publisher');

const pub = new MQTTPublisher('localhost', 1883);
await pub.connect();

// Publish a test switch
const device = FIXTURES.switch();
await pub.publishDevice(device, { switch: false });

// Toggle switch
await pub.publishDeviceState('zigbee', 'test-switch-001', null, { switch: true });

await pub.disconnect();
```

### Check Service Logs

```bash
# All services
npm run docker:logs

# Specific service
docker-compose -f tests/integration/docker-compose.yml logs -f tcp-server
docker-compose -f tests/integration/docker-compose.yml logs -f homed-client
docker-compose -f tests/integration/docker-compose.yml logs -f mqtt
```

### Access Server Logs

```bash
docker logs homed-test-server --tail 50 -f
```

### Check TCP Connections

```bash
docker exec homed-test-server netstat -an | grep 8042
```

## Troubleshooting

### Problem: Services won't start

**Solution:**
```bash
# Check Docker is running
docker ps

# Remove old containers
npm run docker:down
docker volume prune -f

# Restart
npm run docker:up
```

### Problem: Client can't connect to server

**Check 1:** Is the token correct?
```bash
cat tests/integration/homed-cloud.conf | grep token
sqlite3 tests/integration/test.db "SELECT clientToken FROM User;"
```

**Check 2:** Network connectivity
```bash
docker exec homed-test-client ping tcp-server
docker exec homed-test-client nc -zv tcp-server 8042
```

**Fix:** Regenerate configuration
```bash
npm run seed:test
npm run docker:down
npm run docker:up
```

### Problem: Tests failing with timeout

**Solution:** Increase test timeout in test files or check services are healthy
```bash
# Check service health
docker ps --filter "name=homed-test"

# All should show "healthy" status
```

### Problem: Database locked

**Solution:**
```bash
# Stop all services
npm run docker:down

# Remove database
rm tests/integration/test.db

# Reseed
npm run seed:test
npm run docker:up
```

## Cleanup

### Stop Services (keep data)

```bash
npm run docker:down
```

### Full Cleanup (remove all data)

```bash
cd tests/integration
docker-compose down -v --rmi local
cd ../..
rm tests/integration/test.db
rm tests/integration/homed-cloud.conf
```

## File Structure

```
tests/integration/
├── docker-compose.yml          # Service orchestration
├── Dockerfile                  # TCP server container build
├── mosquitto.conf              # MQTT broker config
├── client-entrypoint.sh        # Client startup script
├── homed-cloud.conf.template   # Client config template
├── homed-cloud.conf            # Generated client config (gitignored)
├── .env.test                   # Test environment variables
├── test.db                     # SQLite database (gitignored)
├── seed-test-data.ts           # Database seeding script
├── mqtt-publisher.ts           # MQTT test utility
├── test-utils.ts               # Test helper functions
├── tcp-client-flow.test.ts     # Client connection tests
├── message-flow.test.ts        # Message routing tests
├── jest.setup.ts               # Test environment setup
├── jest.teardown.ts            # Test cleanup
├── README.md                   # Detailed guide
└── manual-scenarios.md         # Manual testing procedures
```

## Environment Variables

Edit `tests/integration/.env.test`:

```env
DATABASE_URL="file:./test.db"
TCP_PORT=8042
PORT=8080
NODE_ENV=test
JWT_SECRET=test-jwt-secret-for-integration-tests
TEST_USERNAME=test-user
TEST_PASSWORD=test-password
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_PREFIX=homed
CLIENT_CONNECT_TIMEOUT=5000
MESSAGE_PROPAGATION_TIMEOUT=3000
```

## CI/CD Integration

Add to GitHub Actions:

```yaml
- name: Run Integration Tests
  run: |
    npm run seed:test
    npm run docker:up
    npm run test:integration
    npm run docker:down
```

## Next Steps

After verifying integration tests pass:

1. ✅ TCP server and client communication verified
2. ⏭️ Implement OAuth 2.0 endpoints (Step 3)
3. ⏭️ Implement capability mapping (Step 4)
4. ⏭️ Integrate Google Home Graph API (Step 5)

Each subsequent step will build on this integration test foundation.
