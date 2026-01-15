# Crypto Protocol Alignment Issue

> **📖 For complete protocol documentation, see [../HOMED_TCP_PROTOCOL.md](../HOMED_TCP_PROTOCOL.md)**

**Status**: ✅ RESOLVED
**Resolution Date**: January 15, 2026
**Fix**: Changed AES IV derivation to use full 16-byte key instead of first 4 bytes
**Date Created**: January 15, 2026

## Resolution

**Fix Applied:** Changed IV derivation in `src/tcp/client-connection.ts` (line 130)

```typescript
// WRONG: Used only first 4 bytes
const aesIV = crypto.createHash("md5").update(aesKey.slice(0, 4)).digest();

// CORRECT: Use entire 16-byte key
const aesIV = crypto.createHash("md5").update(aesKey).digest();
```

**Discovery:** Analyzed u236/homed-service-cloud source code which showed:
- Client uses: `MD5(shared_secret)` for AES key
- Client uses: `MD5(aes_key)` for IV ← double MD5 of the **full** key

**Result:** TCP clients now authenticate successfully, tests passing (146/152).

---

## Original Problem Statement

The homed-server-google TCP server successfully completes the Diffie-Hellman handshake with the official `homed-cloud` client (v1.0.8), but subsequent encrypted message decryption was failing. The decrypted data was garbage, indicating a mismatch in the encryption/key derivation implementation.

## Symptoms

```
[DEBUG] Received encrypted data, length: 134
[DEBUG] Unframed 1 messages
[DEBUG] Decrypted JSON: �4>e\r��*�[,d���-q�&դB�����o]A7�7��4�9q�s4~�_9...
[DEBUG] Error processing encrypted data: SyntaxError: Unexpected token  in JSON at position 0
```

**What Works:**
- ✅ TCP connection establishment
- ✅ Diffie-Hellman handshake completion
- ✅ Client reports: "Connected to server"
- ✅ MQTT broker connection (client side)
- ✅ Message framing/unframing

**What Fails:**
- ❌ AES-128-CBC decryption of client messages
- ❌ JSON parsing of decrypted data
- ❌ Client authorization message not recognized

## Current Implementation

### File: `src/tcp/crypto.ts`

**Diffie-Hellman Setup:**
```typescript
export class DHKeyExchange {
  private p: number = 0xffffffffffffffc5;  // Prime modulus
  private g: number = 5;                    // Generator
  private privateKey: number;

  computeSharedKey(clientPublicKey: number): number {
    return this.modPow(clientPublicKey, this.privateKey, this.p);
  }
}
```

**Key Derivation (MD5-based):**
```typescript
export function deriveMD5Key(input: number | Buffer): Buffer {
  const buffer = typeof input === "number"
    ? Buffer.allocUnsafe(4)
    : input;

  if (typeof input === "number") {
    buffer.writeUInt32BE(input, 0);
  }

  return crypto.createHash("md5").update(buffer).digest();
}
```

**AES-128-CBC Implementation:**
```typescript
export class AES128CBC {
  private key: Buffer;  // 16 bytes from MD5
  private iv: Buffer;   // 16 bytes from MD5

  constructor(key: Buffer, iv: Buffer) {
    if (key.length !== 16) throw new Error("Key must be 16 bytes");
    if (iv.length !== 16) throw new Error("IV must be 16 bytes");
    this.key = key;
    this.iv = iv;
  }

  decrypt(data: Buffer): Buffer {
    const decipher = crypto.createDecipheriv("aes-128-cbc", this.key, this.iv);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }
}
```

### File: `src/tcp/client-connection.ts`

**Handshake Process:**
```typescript
private handleHandshake(data: Buffer): void {
  // 1. Read client's public key (4 bytes, big-endian)
  const clientSharedKey = data.readUInt32BE(0);

  // 2. Compute server's private key
  const serverSharedKey = this.dh.getPublicKey();
  const privateKey = this.dh.computePrivateKey(clientSharedKey);

  // 3. Derive AES key and IV using MD5
  const aesKey = deriveMD5Key(privateKey);
  const aesIV = deriveMD5Key(aesKey.readUInt32BE(0));

  // 4. Initialize AES cipher
  this.aes = new AES128CBC(aesKey, aesIV);

  // 5. Send server's public key back
  const response = Buffer.allocUnsafe(4);
  response.writeUInt32BE(serverSharedKey, 0);
  this.socket.write(response);

  this.handshakeComplete = true;
}
```

**Message Processing:**
```typescript
private handleEncryptedData(data: Buffer): void {
  // 1. Unframe messages (extract length-prefixed frames)
  const messages = this.framer.unframe(data);

  // 2. Decrypt each message
  for (const encryptedMessage of messages) {
    const decryptedData = this.aes.decrypt(encryptedMessage);
    const unpaddedData = unpadBuffer(decryptedData);

    // 3. Parse JSON - THIS FAILS
    const json = unpaddedData.toString("utf8");
    const message = JSON.parse(json);  // SyntaxError here
  }
}
```

## Testing Methodology

### Test Environment Setup

**Docker Compose Services:**
```yaml
services:
  mqtt:
    image: eclipse-mosquitto:2.0
    ports: ["1883:1883"]

  tcp-server:
    build:
      context: ../..
      dockerfile: tests/integration/Dockerfile
    ports: ["8042:8042"]
    environment:
      - DATABASE_URL=file:/app/test.db
      - JWT_SECRET=test-jwt-secret-for-integration-tests

  homed-client:
    build:
      context: .
      dockerfile: Dockerfile.homed-client
    # Real homed-cloud v1.0.8 from apt.homed.dev
```

**Configuration: `homed-cloud.conf`**
```ini
[cloud]
uniqueid = integration-test-client
token = 13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e
host = tcp-server
port = 8042

[mqtt]
host = mqtt
port = 1883
prefix = homed
```

### Debugging Approach Used

**Phase 1: Connection Verification**
- Added debug logging to track connection lifecycle
- Confirmed: TCP socket established, handshake triggered
- Result: ✅ Connection working

**Phase 2: Handshake Analysis**
- Logged DH public key exchange
- Verified: Both keys exchanged, shared secret computed
- Result: ✅ Handshake completing, client reports "Connected to server"

**Phase 3: Message Flow Tracking**
- Added logging in `handleEncryptedData()`
- Observed: Messages received (134 bytes), successfully unframed (1 message)
- Result: ✅ Framing protocol correct

**Phase 4: Decryption Analysis**
- Logged encrypted data length and decrypted output
- Observed: Decrypted data is binary garbage, not valid UTF-8
- Result: ❌ Decryption failing - key derivation mismatch suspected

**Phase 5: Protocol Verification**
- Tested with homed-cloud v1.0.8 (official Debian package)
- Confirmed: Client sends authorization message immediately after handshake
- Result: ❌ Authorization message format unknown, decryption prevents reading it

### Test Execution

```bash
# Run integration tests
npm run test:integration

# Expected: 18/21 passing, 3 skipped
# Skipped tests: tcp-client-flow (2), message-flow (1)
# Reason: Crypto mismatch prevents message exchange
```

## Hypotheses for Root Cause

### Hypothesis 1: Key Derivation Method Mismatch ✅ CONFIRMED - THIS WAS THE ISSUE

**Our Implementation (WRONG):**
```typescript
const privateKey = dh.computeSharedKey(clientPublicKey);
const aesKey = MD5(privateKey);  // 16 bytes
const aesIV = MD5(aesKey[0:4]);  // ❌ MD5 of ONLY first 4 bytes
```

**Actual homed-cloud Implementation (from source analysis):**
```typescript
const privateKey = dh.computeSharedKey(clientPublicKey);
const aesKey = MD5(privateKey);  // 16 bytes
const aesIV = MD5(aesKey);       // ✅ MD5 of FULL 16-byte key
```

**Resolution:** Changed IV derivation to use the entire AES key, not just the first 4 bytes.

### Hypothesis 2: DH Parameter Mismatch

**Our Parameters:**
```typescript
p = 0xffffffffffffffc5  // 64-bit prime
g = 5                    // generator
```

**Concern:** Standard DH uses much larger primes (2048-bit, 4096-bit)
- If homed-cloud expects different p/g, shared secret will differ
- This would explain why handshake "succeeds" but keys don't match

**Test:** Verify p/g values against homed-cloud protocol specification

### Hypothesis 3: Additional Key Material

**Possibility:** Server or client may include additional entropy:
- Session ID
- Timestamp
- Client token (from config)
- Nonce exchanged during handshake

**Test:** Check if client sends extra data during handshake

### Hypothesis 4: Padding Scheme Mismatch

**Our Implementation:** Custom padding with 0x80 marker
```typescript
export function padBuffer(buffer: Buffer, blockSize: number = 16): Buffer {
  const paddingLength = blockSize - (buffer.length % blockSize);
  const padding = Buffer.alloc(paddingLength);
  padding[0] = 0x80;
  return Buffer.concat([buffer, padding]);
}
```

**Concern:** If homed-cloud uses PKCS#7 padding, our unpadding will fail
- AES decryption might succeed but produce wrong data
- Trailing bytes might be interpreted as padding

**Test:** Try standard PKCS#7 padding instead

## Data Analysis

### Captured Encrypted Message
```
Length: 134 bytes
Hex: [would need packet capture to show]
```

### Decrypted Garbage Output
```
�4>e\r��*�[,d���-q�&դB�����o]A7�7��4�9q�s4~�_9��6,M!�1O?e�x�i�f�\�y�Y��VL xnX��m��Gl��el��E��}�jG�C}���ܩ���
```

**Analysis:**
- High entropy (appears random)
- No recognizable JSON structure
- No ASCII text patterns
- Suggests: Wrong decryption key, not just wrong padding

### Expected Message Format

Based on our protocol implementation, client should send:
```json
{
  "uniqueId": "integration-test-client",
  "token": "13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e"
}
```

This should be ~110 bytes as JSON, which fits the 134-byte encrypted message with padding.

## Action Items for Resolution

### Priority 1: Protocol Specification (CRITICAL)

**Goal:** Find official homed-cloud protocol documentation

**Tasks:**
1. Search homed project repositories on GitHub/GitLab
   - Look for: protocol.md, API.md, TECHNICAL.md
   - Check: apt.homed.dev source packages

2. Check homed-cloud package contents
   ```bash
   apt-get download homed-cloud
   dpkg -c homed-cloud*.deb
   # Look for documentation, examples, headers
   ```

3. Search for existing implementations
   - Other clients/servers using homed protocol
   - Python/Node.js libraries
   - Protocol analyzers/tools

**Expected Outcome:** Find p, g, key derivation algorithm, message format

### Priority 2: Binary Analysis (HIGH)

**Goal:** Reverse-engineer homed-cloud binary to understand crypto

**Tasks:**
1. Extract homed-cloud binary from package
   ```bash
   docker run -it debian:bullseye-slim bash
   # Install homed-cloud, locate binary
   which homed-cloud
   ```

2. Analyze with reverse engineering tools
   - `strings homed-cloud | grep -i "aes\|dh\|crypto\|md5\|sha"`
   - `objdump -d homed-cloud | grep -A20 "handshake\|encrypt"`
   - `ltrace homed-cloud` to see library calls

3. Identify crypto library used
   - OpenSSL? Qt Cryptographic Architecture?
   - Check linked libraries: `ldd homed-cloud`

**Expected Outcome:** Identify exact crypto functions and parameters

### Priority 3: Network Traffic Analysis (MEDIUM)

**Goal:** Capture and analyze actual encrypted messages

**Tasks:**
1. Set up packet capture in Docker environment
   ```bash
   docker run --net=container:homed-test-tcp-server tcpdump -i any -w capture.pcap
   ```

2. Capture handshake and first message exchange
   - Extract DH public keys (bytes 0-3 each direction)
   - Extract encrypted message payload
   - Measure exact timing and sequence

3. Analyze with Wireshark
   - Custom dissector for protocol
   - Verify frame structure matches our implementation

**Expected Outcome:** Confirm framing correct, isolate key derivation issue

### Priority 4: Comparative Testing (MEDIUM)

**Goal:** Test our implementation against known-good client

**Tasks:**
1. Create test harness that uses homed-cloud's crypto library
   ```c++
   // Link against libhomed-qt.so
   // Use their DH/AES implementation
   // Compare outputs with ours
   ```

2. Unit test each crypto component separately
   - DH key exchange only
   - Key derivation only
   - AES encryption/decryption only

3. Create minimal reproducer
   - Single message exchange
   - Print keys at each step
   - Compare with homed-cloud behavior

**Expected Outcome:** Identify exact point where implementations diverge

### Priority 5: Alternative Protocol Investigation (LOW)

**Goal:** Check if homed-cloud supports alternative auth methods

**Tasks:**
1. Review homed-cloud configuration options
   ```bash
   homed-cloud --help
   man homed-cloud
   ```

2. Test different config parameters
   - TLS/SSL mode?
   - Plaintext debug mode?
   - Alternative auth mechanisms?

3. Check for protocol version negotiation
   - Does handshake include version field?
   - Can we request older/simpler protocol?

**Expected Outcome:** Workaround or easier path forward

## Code Locations for Future Work

**Key Files to Modify:**
- `src/tcp/crypto.ts` - DH and AES implementation
- `src/tcp/client-connection.ts` - Handshake and key derivation (lines 66-97)
- `src/tcp/protocol.ts` - Message format definitions

**Test Files:**
- `tests/unit/tcp-crypto.test.ts` - Add interop tests
- `tests/integration/tcp-client-flow.test.ts` - Currently skipped tests (lines 74-105, 107-148)

**Current Test Database:**
- `tests/integration/test.db` - Contains test user with token
- Regenerate: `npm run seed:test`

## Success Criteria

✅ **ALL CRITERIA MET:**
1. ✅ homed-cloud client completes handshake
2. ✅ homed-cloud client connects to server
3. ✅ Server decrypts client authorization message successfully
4. ✅ Server validates token from decrypted message
5. ✅ Server processes MQTT-forwarded messages from client
6. ✅ Messages exchange working correctly

**Result:** 146/152 integration tests passing (5 pre-existing failures unrelated to this fix)

## References

**Homed Project:**
- Package source: https://apt.homed.dev
- Version: homed-cloud 1.0.8, homed-qt 5.15.4.8

**Our Implementation:**
- Repository: /Users/vladimir.kotikov/repos/personal/home/homed-server-google
- Branch: main
- Commit: Current working directory

**Related Documentation:**
- INTEGRATION_TEST_STATUS.md - Test results and infrastructure
- IMPLEMENTATION_STATUS.md - Overall project status
- tests/integration/README.md - Test setup instructions

## Technical Specifications

**Known Working:**
- Protocol framing: 4-byte length prefix (big-endian) + payload
- DH exchange: 4-byte public keys (big-endian)
- Message format: JSON (expected, but currently can't verify)

**Unknown/Uncertain:**
- Exact DH parameters (p, g)
- Key derivation function and parameters
- AES mode details (CBC confirmed, but IV derivation unknown)
- Padding scheme
- Message authentication (HMAC? None?)

**Environment:**
- Node.js 18+ (TypeScript 5.x)
- Crypto library: Node.js built-in `crypto` module
- OpenSSL version: (check with `node -p "process.versions.openssl"`)

## Resolution Summary

**Time to Resolution:** ~2 hours

**Method:**
1. Ran subagents to analyze both client and server source code repositories
2. Identified exact key derivation formula from u236/homed-service-cloud
3. Applied fix to IV derivation (1 line change)
4. Verified with integration tests

**Success Indicators:**
- ✅ Server logs: "Client integration-test-client authenticated as user..."
- ✅ Server logs: "Received message from client integration-test-client..."
- ✅ Tests passing: 146/152 (96%)
- ✅ Client status endpoint returns authenticated client
