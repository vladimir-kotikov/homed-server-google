# Manual Integration Test Scenarios

This document provides step-by-step manual testing procedures for validating the integration between the TCP server and homed-service-cloud client.

## Prerequisites

- Docker environment running (`docker-compose up -d`)
- Test database seeded (`npm run seed:test`)
- MQTT client tools installed (optional, for debugging)

---

## Scenario 1: Client Connection and Authentication

### Objective

Verify that the homed-service-cloud client successfully connects to the TCP server, completes the DH handshake, and authenticates with the client token.

### Steps

1. **Start with clean state:**

   ```bash
   docker-compose down
   docker-compose up -d mqtt tcp-server
   ```

2. **Monitor TCP server logs:**

   ```bash
   docker-compose logs -f tcp-server
   ```

3. **Start the client:**

   ```bash
   docker-compose up -d homed-client
   ```

4. **Watch for connection sequence:**
   Look for these log messages in order:
   - `TCP server listening on port 8042`
   - `Client connected from <ip>`
   - `Handshake initiated`
   - `Handshake completed`
   - `Client authenticated: integration-test-client`

### Expected Results

✅ **Success indicators:**

- No error messages in logs
- Client container stays running (doesn't restart)
- Connection stays established for at least 30 seconds

❌ **Failure indicators:**

- `Authentication failed` in logs
- Client container continuously restarting
- Connection timeout errors

### Troubleshooting

If client can't connect:

```bash
# Check if port is open
docker-compose exec homed-client nc -zv tcp-server 8042

# Verify token matches
cat homed-cloud.conf | grep token
sqlite3 test.db "SELECT clientToken FROM User LIMIT 1;"
```

---

## Scenario 2: Device Discovery via MQTT

### Objective

Verify that device data published to MQTT is forwarded by the client to the TCP server.

### Steps

1. **Ensure client is connected** (from Scenario 1)

2. **Open three terminal windows:**

   **Terminal 1 - TCP Server logs:**

   ```bash
   docker-compose logs -f tcp-server
   ```

   **Terminal 2 - Client logs:**

   ```bash
   docker-compose logs -f homed-client
   ```

   **Terminal 3 - MQTT monitor:**

   ```bash
   docker-compose exec mqtt mosquitto_sub -v -t "homed/#"
   ```

3. **Publish a test device to MQTT:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/status/zigbee" \
     -m '{
       "devices": [
         {
           "key": "test-switch-001",
           "name": "Test Switch",
           "description": "Integration test device"
         }
       ],
       "version": "1.0.0"
     }' \
     -r
   ```

4. **Publish device capabilities:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/expose/zigbee/test-switch-001" \
     -m '{
       "endpoints": [
         {
           "id": 1,
           "type": "switch",
           "exposes": ["switch"],
           "options": {}
         }
       ]
     }' \
     -r
   ```

5. **Publish device availability:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/device/zigbee/test-switch-001" \
     -m '{"status": "online"}' \
     -r
   ```

### Expected Results

✅ **Success indicators:**

- MQTT messages appear in Terminal 3
- Client logs show received MQTT messages (Terminal 2)
- TCP server logs show incoming encrypted messages (Terminal 1)
- Server logs show parsed device data with topic `status/zigbee` or `expose/zigbee/test-switch-001`

❌ **Failure indicators:**

- MQTT messages published but not received by client
- Client receives but doesn't forward to server
- Server receives but can't decrypt/parse messages

---

## Scenario 3: Device State Updates

### Objective

Verify that device state changes published to MQTT are forwarded through the entire pipeline.

### Steps

1. **Complete Scenario 2 first** (device must exist)

2. **Monitor all components:**

   ```bash
   # Terminal 1
   docker-compose logs -f tcp-server | grep -E "publish|message"

   # Terminal 2
   docker-compose logs -f homed-client

   # Terminal 3
   docker-compose exec mqtt mosquitto_sub -v -t "homed/fd/#"
   ```

3. **Publish state update (switch OFF):**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/fd/zigbee/test-switch-001" \
     -m '{"switch": false}'
   ```

4. **Wait 2-3 seconds, then publish state update (switch ON):**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/fd/zigbee/test-switch-001" \
     -m '{"switch": true}'
   ```

5. **Publish state with additional data:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/fd/zigbee/test-switch-001" \
     -m '{
       "switch": true,
       "linkQuality": 255,
       "timestamp": '$(date +%s)'
     }'
   ```

### Expected Results

✅ **Success indicators:**

- All state updates visible in MQTT subscriber (Terminal 3)
- Client forwards each state change to TCP server
- Server logs show `action: "publish"` with topic `fd/zigbee/test-switch-001`
- State values correctly parsed (switch: true/false)

### Verification Queries

Check that TCP server maintains state:

```bash
# If server stores device state (future feature):
curl http://localhost:8080/devices/test-switch-001/state
```

---

## Scenario 4: Multiple Devices

### Objective

Verify the system handles multiple devices simultaneously.

### Steps

1. **Publish multiple devices at once:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/status/zigbee" \
     -m '{
       "devices": [
         {"key": "switch-001", "name": "Living Room Switch"},
         {"key": "switch-002", "name": "Bedroom Switch"},
         {"key": "light-001", "name": "Kitchen Light"},
         {"key": "sensor-001", "name": "Temperature Sensor"}
       ],
       "version": "1.0.0"
     }' \
     -r
   ```

2. **Publish capabilities for each device:**

   ```bash
   # Switch 1
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/expose/zigbee/switch-001" \
     -m '{"endpoints": [{"id": 1, "type": "switch", "exposes": ["switch"]}]}' -r

   # Switch 2
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/expose/zigbee/switch-002" \
     -m '{"endpoints": [{"id": 1, "type": "switch", "exposes": ["switch"]}]}' -r

   # Light
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/expose/zigbee/light-001" \
     -m '{"endpoints": [{"id": 1, "type": "light", "exposes": ["light", "level"]}]}' -r

   # Sensor
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/expose/zigbee/sensor-001" \
     -m '{"endpoints": [{"id": 1, "type": "sensor", "exposes": ["temperature", "humidity"]}]}' -r
   ```

3. **Send rapid state updates:**

   ```bash
   for i in {1..10}; do
     docker-compose exec mqtt mosquitto_pub \
       -t "homed/fd/zigbee/switch-001" \
       -m "{\"switch\": $((i % 2))}"
     sleep 0.5
   done
   ```

### Expected Results

✅ **Success indicators:**

- All 4 devices received by client
- All 4 devices forwarded to TCP server
- Rapid state updates don't cause message loss
- No client disconnections or errors

---

## Scenario 5: Client Reconnection

### Objective

Verify that the client can reconnect after disconnection.

### Steps

1. **Establish initial connection** (Scenario 1)

2. **Publish some devices** (Scenario 2)

3. **Simulate server restart:**

   ```bash
   docker-compose restart tcp-server
   ```

4. **Monitor reconnection:**

   ```bash
   docker-compose logs -f homed-client tcp-server
   ```

5. **Verify devices still work:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/fd/zigbee/test-switch-001" \
     -m '{"switch": true}'
   ```

### Expected Results

✅ **Success indicators:**

- Client detects server disconnect
- Client automatically reconnects within 5-10 seconds
- Handshake and authentication complete again
- State updates work after reconnection

❌ **Failure indicators:**

- Client doesn't reconnect
- Authentication fails after reconnection
- Messages lost during reconnection window

---

## Scenario 6: Error Handling

### Objective

Verify graceful handling of invalid data and edge cases.

### Steps

1. **Test invalid JSON:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/status/zigbee" \
     -m 'this is not json'
   ```

2. **Test missing required fields:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/expose/zigbee/test-device" \
     -m '{}'
   ```

3. **Test very large message:**

   ```bash
   # Create 1MB JSON
   echo '{"data": "'$(head -c 1000000 /dev/urandom | base64)'"}' | \
   docker-compose exec -T mqtt mosquitto_pub \
     -t "homed/fd/zigbee/test-device" \
     -s
   ```

4. **Test special characters:**

   ```bash
   docker-compose exec mqtt mosquitto_pub \
     -t "homed/fd/zigbee/test-device" \
     -m '{"name": "Test\u0000\u0042\u0043\u0044"}'
   ```

### Expected Results

✅ **Success indicators:**

- Invalid messages logged but don't crash client
- Server continues processing valid messages
- Special characters in payload handled correctly (escaped/encrypted)
- Large messages processed or rejected gracefully

---

## Performance Benchmarks

### Message Throughput

Test sustained message rate:

```bash
# Terminal 1: Monitor
docker-compose logs -f tcp-server | grep "message received" | pv -l > /dev/null

# Terminal 2: Generate load
for i in {1..1000}; do
  docker-compose exec mqtt mosquitto_pub \
    -t "homed/fd/zigbee/test-$i" \
    -m "{\"value\": $i}"
done
```

**Expected:** Handle 50-100 messages/second without errors

### Connection Stability

Long-running test:

```bash
# Run for 1 hour
timeout 3600 docker-compose logs -f homed-client | grep -E "disconnect|error"
```

**Expected:** No unexpected disconnections, stable connection for duration

---

## Debugging Tips

### Enable Verbose Logging

Add to docker-compose.yml under tcp-server environment:

```yaml
- LOG_LEVEL=debug
```

### Capture MQTT Traffic

```bash
# Save all MQTT messages to file
docker-compose exec mqtt mosquitto_sub -v -t "#" > mqtt-traffic.log
```

### Analyze TCP Traffic

```bash
# Install tcpdump in server container
docker-compose exec tcp-server apk add tcpdump

# Capture TCP packets
docker-compose exec tcp-server tcpdump -i any -w /tmp/tcp.pcap port 8042
docker cp homed-test-server:/tmp/tcp.pcap .
```

### Check Encryption

Verify DH handshake and AES encryption:

```bash
# Look for handshake hex dumps in debug logs
docker-compose logs tcp-server | grep -A5 "handshake"
```

---

## Summary Checklist

Use this checklist for full integration validation:

- [ ] Client connects to TCP server
- [ ] DH handshake completes
- [ ] Client authenticates with token
- [ ] Device list published and received
- [ ] Device capabilities published and received
- [ ] Device states update correctly
- [ ] Multiple devices handled simultaneously
- [ ] Client reconnects after disconnect
- [ ] Invalid data handled gracefully
- [ ] No memory leaks over 1 hour
- [ ] Message throughput acceptable (50+ msg/s)
- [ ] All containers remain healthy
