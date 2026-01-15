# HOMEd TCP Protocol - Complete Reference

**Last Updated:** January 15, 2026
**Protocol Version:** Compatible with homed-cloud v1.0.8
**Status:** ✅ Fully implemented and working

---

## Table of Contents

1. [Overview](#overview)
2. [Handshake Protocol](#handshake-protocol)
3. [Key Derivation](#key-derivation)
4. [Encryption & Framing](#encryption--framing)
5. [Authorization Flow](#authorization-flow)
6. [Critical Quirks & Issues](#critical-quirks--issues)
7. [Security Considerations](#security-considerations)
8. [Implementation Checklist](#implementation-checklist)
9. [Code References](#code-references)

---

## Overview

The HOMEd TCP protocol is a custom encrypted communication protocol used between HOMEd service clients (typically embedded devices) and the HOMEd cloud server. It uses:

- **Transport:** TCP (default port 8042)
- **Key Exchange:** Simplified 32-bit Diffie-Hellman
- **Encryption:** AES-128-CBC with MD5 key derivation
- **Framing:** Custom byte-stuffing protocol
- **Message Format:** JSON (encrypted)

### Protocol Flow Diagram

```
Client                                Server
  |                                      |
  |------ [12 bytes] p,g,A ------------->|  DH handshake (big-endian)
  |                                      |
  |<----- [4 bytes] B --------------------|  Server public key (big-endian)
  |                                      |
  | (Both compute shared secret)         |
  | (Both derive: key=MD5(secret), iv=MD5(key)) |
  |                                      |
  |------ 0x42 [encrypted auth] 0x43 --->|  Authorization JSON
  |       {"uniqueId":"...","token":...} |
  |                                      |
  |<----- 0x42 [encrypted msgs] 0x43 ----|  Encrypted message exchange
  |                                      |
```

---

## Handshake Protocol

### Message Structure

**Client → Server (12 bytes, big-endian):**
```
Offset | Size | Field          | Description
-------|------|----------------|----------------------------------
0      | 4    | prime (p)      | DH prime modulus
4      | 4    | generator (g)  | DH generator
8      | 4    | clientPublicKey| Client's DH public key (g^a mod p)
```

**Server → Client (4 bytes, big-endian):**
```
Offset | Size | Field           | Description
-------|------|-----------------|----------------------------------
0      | 4    | serverPublicKey | Server's DH public key (g^b mod p)
```

### Client Implementation

**Source:** u236/homed-service-cloud `controller.cpp` (lines 183-195)

```cpp
void Controller::connected(void) {
    handshakeRequest handshake;

    // Generate random DH parameters
    m_dh = new DH;

    // Send handshake (big-endian)
    handshake.prime = qToBigEndian(m_dh->prime());
    handshake.generator = qToBigEndian(m_dh->generator());
    handshake.sharedKey = qToBigEndian(m_dh->sharedKey());

    m_socket->write(QByteArray(reinterpret_cast<char*>(&handshake),
                               sizeof(handshake)));
}
```

**DH Parameter Generation (crypto.cpp lines 163-168):**
```cpp
DH::DH(void) {
    m_prime = QRandomGenerator::global()->bounded(1, INT_MAX);
    m_generator = QRandomGenerator::global()->bounded(1, INT_MAX);
    m_seed = QRandomGenerator::global()->bounded(1, INT_MAX);
}
```

⚠️ **Important:** Client uses **random integers**, not cryptographic primes!

### Server Implementation

**Source:** homed-server-google `src/tcp/client-connection.ts` (lines 89-108)

```typescript
private handleHandshakeData(data: Buffer): void {
  if (data.length < 12) {
    return; // Need full handshake
  }

  // Read client's DH parameters (big-endian)
  const clientPrime = data.readUInt32BE(0);
  const clientGenerator = data.readUInt32BE(4);
  const clientSharedKey = data.readUInt32BE(8);

  // Set DH parameters from client
  this.dh.setPrime(clientPrime);
  this.dh.setGenerator(clientGenerator);

  // Compute shared secret
  const sharedSecret = this.dh.computePrivateKey(clientSharedKey);
  const serverSharedKey = this.dh.getSharedKey();

  // ... (key derivation follows)
}
```

### DH Computation

**Modular Exponentiation:**
```
Client public key: A = g^a mod p
Server public key: B = g^b mod p
Shared secret:     s = A^b mod p = B^a mod p = g^(ab) mod p
```

**Implementation:** `src/tcp/crypto.ts` uses square-and-multiply algorithm with unsigned 32-bit arithmetic (`>>> 0` operators).

---

## Key Derivation

### The Critical Fix 🔑

**WRONG (Original Implementation):**
```typescript
const aesKey = MD5(sharedSecret);       // 16 bytes
const aesIV = MD5(aesKey.slice(0, 4));  // ❌ Only first 4 bytes
```

**CORRECT (Fixed Implementation):**
```typescript
const aesKey = MD5(sharedSecret);       // 16 bytes
const aesIV = MD5(aesKey);              // ✅ Full 16-byte key
```

### Complete Key Derivation Process

**Step 1:** Convert shared secret to big-endian bytes
```typescript
const sharedSecretBuffer = Buffer.allocUnsafe(4);
sharedSecretBuffer.writeUInt32BE(sharedSecret, 0);
```

**Step 2:** First MD5 hash → AES key
```typescript
const aesKey = crypto
  .createHash("md5")
  .update(sharedSecretBuffer)
  .digest();  // 16 bytes
```

**Step 3:** Second MD5 hash → AES IV
```typescript
const aesIV = crypto
  .createHash("md5")
  .update(aesKey)  // ✅ Entire 16-byte key
  .digest();       // 16 bytes
```

### Client-Side Implementation

**Source:** u236/homed-service-cloud `controller.cpp` (lines 216-221)

```cpp
// Read server's public key
quint32 value, key;
memcpy(&value, data.constData(), sizeof(value));
key = qToBigEndian(m_dh->privateKey(qFromBigEndian(value)));

// Double MD5 key derivation
hash = QCryptographicHash::hash(
    QByteArray(reinterpret_cast<char*>(&key), sizeof(key)),
    QCryptographicHash::Md5
);
m_aes->init(hash, QCryptographicHash::hash(hash, QCryptographicHash::Md5));
//                                           ^^^^
//                              Full hash, not hash[0:4]
```

---

## Encryption & Framing

### AES-128-CBC Configuration

**Algorithm:** AES-128-CBC
- **Key Size:** 128 bits (16 bytes)
- **Block Size:** 128 bits (16 bytes)
- **Mode:** CBC (Cipher Block Chaining)
- **Padding:** Zero-padding (NOT PKCS#7)
- **Auto-padding:** Disabled (manual padding required)

**Implementation:** `src/tcp/crypto.ts` (lines 77-112)

```typescript
export class AES128CBC {
  private key: Buffer;  // 16 bytes
  private iv: Buffer;   // 16 bytes

  decrypt(data: Buffer): Buffer {
    const decipher = crypto.createDecipheriv("aes-128-cbc", this.key, this.iv);
    decipher.setAutoPadding(false);  // Manual padding
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }
}
```

### Zero-Padding Scheme

**Padding Process:**
```typescript
function padBuffer(buffer: Buffer): Buffer {
  const paddingLength = 16 - (buffer.length % 16);
  if (paddingLength === 16) {
    return buffer;  // Already aligned
  }

  const padded = Buffer.allocUnsafe(buffer.length + paddingLength);
  buffer.copy(padded);
  padded.fill(0, buffer.length);  // Zero padding

  return padded;
}
```

**Unpadding Process:**
```typescript
function unpadBuffer(buffer: Buffer): Buffer {
  let end = buffer.length;
  while (end > 0 && buffer[end - 1] === 0) {
    end--;
  }
  return buffer.slice(0, end);
}
```

⚠️ **Quirk:** This padding scheme cannot distinguish padding zeros from legitimate data zeros at the end of messages.

### Message Framing Protocol

**Frame Structure:**
```
┌─────────┬─────────────────────────┬─────────┐
│ 0x42    │  Escaped Payload        │ 0x43    │
│ (START) │  (Encrypted JSON)       │ (END)   │
└─────────┴─────────────────────────┴─────────┘
```

**Control Bytes:**
- `0x42` - START marker
- `0x43` - END marker
- `0x44` - ESCAPE marker

**Escape Sequences:**
```
Original Byte | Escaped Sequence | Transformation
--------------|------------------|---------------
0x42 (START)  | 0x44 0x62       | Add 0x44, OR with 0x20
0x43 (END)    | 0x44 0x63       | Add 0x44, OR with 0x20
0x44 (ESCAPE) | 0x44 0x64       | Add 0x44, OR with 0x20
```

### Client Framing Implementation

**Source:** u236/homed-service-cloud `controller.cpp` (lines 107-125)

```cpp
void Controller::sendData(const QByteArray &data) {
    QByteArray buffer = data, packet = QByteArray(1, 0x42);

    // Zero-pad to 16-byte boundary
    if (buffer.length() % 16)
        buffer.append(16 - buffer.length() % 16, 0);

    m_aes->cbcEncrypt(buffer);

    // Escape special bytes
    for (int i = 0; i < buffer.length(); i++) {
        switch (buffer.at(i)) {
            case 0x42: packet.append(0x44).append(0x62); break;
            case 0x43: packet.append(0x44).append(0x63); break;
            case 0x44: packet.append(0x44).append(0x64); break;
            default:   packet.append(buffer.at(i)); break;
        }
    }

    m_socket->write(packet.append(0x43));
}
```

### Server Unframing Implementation

**Source:** homed-server-google `src/tcp/protocol.ts` (lines 41-78)

```typescript
unframe(chunk: Buffer): Buffer[] {
  this.buffer = Buffer.concat([this.buffer, chunk]);
  const messages: Buffer[] = [];
  let start = -1;

  for (let i = 0; i < this.buffer.length; i++) {
    if (this.buffer[i] === START_MARKER && start === -1) {
      start = i;
    } else if (this.buffer[i] === END_MARKER && start !== -1) {
      // Found complete message
      const escapedData = this.buffer.slice(start + 1, i);
      const unescapedData = this.unescape(escapedData);
      messages.push(unescapedData);

      this.buffer = this.buffer.slice(i + 1);
      i = -1;
      start = -1;
    }
  }

  return messages;
}
```

---

## Authorization Flow

### Message Timing

Authorization is sent **immediately after handshake completion**, before any other messages.

### JSON Structure

```json
{
  "uniqueId": "integration-test-client",
  "token": "13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e"
}
```

**Fields:**
- `uniqueId` (string): Client identifier from configuration
- `token` (string): 64-character hex authentication token (SHA-256 hash)

### Encryption Status

✅ **ENCRYPTED** - Authorization message is:
1. Serialized to compact JSON (no whitespace)
2. Zero-padded to 16-byte boundary
3. AES-128-CBC encrypted
4. Escaped according to framing protocol
5. Wrapped in `0x42`...`0x43` markers

### Client Configuration

**Source:** `tests/integration/homed-cloud.conf`
```ini
[cloud]
uniqueid = integration-test-client
token = 13e19d111d4b44f52e62f0cdf8b0980865037b3f1ec0b954e79c1d9290375b6e
host = tcp-server
port = 8042
```

### Server Validation

**Source:** `src/services/auth.service.ts` (lines 11-42)

```typescript
async validateClientToken(token: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { clientToken: token },
  });

  if (!user) return null;

  // Constant-time comparison (prevents timing attacks)
  const tokenBuffer = Buffer.from(token);
  const storedBuffer = Buffer.from(user.clientToken);

  if (tokenBuffer.length !== storedBuffer.length) return null;
  if (!crypto.timingSafeEqual(tokenBuffer, storedBuffer)) return null;

  return user;
}
```

**Security Feature:** Uses constant-time comparison to prevent timing-based token guessing attacks.

---

## Critical Quirks & Issues

### 1. IV Derivation Bug (RESOLVED ✅)

**Issue:** Original implementation used `MD5(aesKey[0:4])` instead of `MD5(aesKey)`

**Impact:** Complete decryption failure, all encrypted messages were garbage

**Fix Applied:** Changed to hash the entire 16-byte key

**Detection:** Required analyzing official homed-cloud source code with subagents

**File:** `src/tcp/client-connection.ts` (line 130)

### 2. Non-Cryptographic DH Parameters

**Issue:** Client generates random 32-bit integers, not cryptographic primes

**Impact:**
- Limited keyspace (2^32 possibilities)
- Vulnerable to pre-computation attacks
- Not secure for internet-facing services

**Mitigation:** Use only on trusted networks (LAN/VPN)

**Standard:** Real DH uses 2048+ bit safe primes

### 3. Zero-Padding Ambiguity

**Issue:** Cannot distinguish padding zeros from legitimate data ending in zeros

**Example:**
```
Message: "test\x00\x00\x00"  (legitimate zeros)
After unpadding: "test"       (data truncated!)
```

**Workaround:** Don't use messages that end with zero bytes

**Recommendation:** PKCS#7 padding would be more robust

### 4. Static IV

**Issue:** IV is derived from key, not randomized per message

**Impact:**
- Same plaintext encrypts to same ciphertext (with same session key)
- Enables pattern analysis across messages
- Breaks semantic security

**Standard:** Best practice is random IV per message

### 5. MD5 Usage

**Issue:** MD5 is cryptographically broken (collision attacks)

**Impact:** Not suitable for security-critical applications

**Reason:** Used for backward compatibility with homed-cloud

**Recommendation:** Use SHA-256 or BLAKE2 for new implementations

### 6. No Message Authentication

**Issue:** No HMAC or similar integrity verification

**Impact:**
- Messages can be tampered with
- No detection of man-in-the-middle attacks
- Vulnerable to replay attacks

**Recommendation:** Use authenticated encryption (AES-GCM) or add HMAC

### 7. Frame Processing Quirks

**Quirk 1:** No explicit length prefix - frame boundaries determined by markers only

**Quirk 2:** Escape processing uses `& 0xDF` mask:
```cpp
case 0x44: buffer.append(m_buffer.at(++i) & 0xDF); break;
```
This converts: `0x62 → 0x42`, `0x63 → 0x43`, `0x64 → 0x44`

**Quirk 3:** Start marker (`0x42`) in middle of frame clears buffer:
```cpp
case 0x42: buffer.clear(); break;
```

### 8. Byte Order Sensitivity

**Critical:** ALL multi-byte integers must use **BIG-ENDIAN** encoding

**Applies to:**
- DH parameters (p, g)
- Public keys
- Shared secret

**Common Bug:** Using little-endian or native byte order causes complete protocol failure

---

## Security Considerations

### Threat Model

**Appropriate For:**
- Home automation on trusted LANs
- Hobbyist/internal projects
- Development and testing
- Learning about cryptographic protocols

**NOT Appropriate For:**
- Internet-facing services
- Security-critical applications
- Financial or medical data
- Multi-tenant environments
- Production deployments

### Vulnerability Summary

| Vulnerability | Severity | Impact |
|--------------|----------|--------|
| 32-bit DH keyspace | HIGH | Brute-force feasible |
| MD5 key derivation | MEDIUM | Collision attacks possible |
| Static IV | MEDIUM | Pattern analysis |
| No message auth | HIGH | Tampering undetected |
| Zero-padding | LOW | Data truncation edge cases |
| Non-prime DH parameters | HIGH | Weak key exchange |

### Recommendations for Production

**For New Implementations:**
1. Use **TLS 1.3** instead of custom crypto
2. Use **ECDH** with P-256 or X25519
3. Use **SHA-256** or **HKDF** for key derivation
4. Use **AES-256-GCM** (authenticated encryption)
5. Use **random IV** per message
6. Implement **Perfect Forward Secrecy**

**For Compatibility Mode (if required):**
- Document security limitations clearly
- Use only on trusted/isolated networks
- Implement rate limiting and monitoring
- Rotate tokens frequently
- Plan migration path to modern crypto

---

## Implementation Checklist

### Server Implementation (Node.js/TypeScript)

- [x] Accept 12-byte handshake (p, g, A) in big-endian
- [x] Generate random 32-bit private key
- [x] Compute server public key: `B = g^b mod p`
- [x] Send 4-byte B in big-endian
- [x] Compute shared secret: `s = A^b mod p`
- [x] Derive AES key: `MD5(shared_secret_bytes)`
- [x] Derive AES IV: `MD5(AES_key)` ← full 16-byte key
- [x] Implement AES-128-CBC with zero-padding
- [x] Implement frame protocol (0x42/0x43/0x44 markers)
- [x] Implement escape/unescape logic
- [x] Parse encrypted authorization JSON
- [x] Validate token against database
- [x] Use constant-time comparison for tokens
- [x] Handle streaming message buffer

### Client Implementation (C++/Qt)

**Reference:** u236/homed-service-cloud

- [x] Generate random DH parameters (p, g, seed)
- [x] Compute client public key: `A = g^seed mod p`
- [x] Send 12-byte handshake (p, g, A) in big-endian
- [x] Read 4-byte server public key (big-endian)
- [x] Compute shared secret: `s = B^seed mod p`
- [x] Derive AES key and IV using double MD5
- [x] Implement AES-128-CBC encryption/decryption
- [x] Implement frame protocol with escaping
- [x] Send encrypted authorization JSON
- [x] Handle encrypted message exchange

### Testing Checklist

- [x] Verify big-endian byte order for all integers
- [x] Test key derivation with known values
- [x] Verify AES encryption/decryption round-trip
- [x] Test frame escaping for all control bytes
- [x] Test streaming message reassembly
- [x] Verify authorization token validation
- [x] Test with official homed-cloud client v1.0.8
- [x] Integration tests with Docker environment

---

## Code References

### Server Implementation (homed-server-google)

| File | Lines | Purpose |
|------|-------|---------|
| `src/tcp/server.ts` | 28-97 | TCP server, connection management |
| `src/tcp/client-connection.ts` | 89-143 | Handshake, key derivation |
| `src/tcp/crypto.ts` | 7-137 | DH and AES implementation |
| `src/tcp/protocol.ts` | 28-115 | Message framing/unframing |
| `src/services/auth.service.ts` | 11-42 | Token validation |
| `src/index.ts` | 101-121 | Event wiring |

### Client Implementation (u236/homed-service-cloud)

| File | Lines | Purpose |
|------|-------|---------|
| `controller.h` | 10-15 | Handshake structure |
| `controller.cpp` | 71-77 | Configuration loading |
| `controller.cpp` | 183-195 | Connection, handshake send |
| `controller.cpp` | 214-225 | Handshake response, key derivation |
| `controller.cpp` | 107-125 | Encryption, framing, sending |
| `controller.cpp` | 228-248 | Receiving, unframing, decryption |
| `crypto.h` | 1-39 | AES128 and DH class definitions |
| `crypto.cpp` | 163-211 | DH implementation |
| `crypto.cpp` | 20-59 | AES-128-CBC implementation |

---

## Debugging Tips

### Enable Debug Logging

**Server (Node.js):**
```typescript
console.log(`DEBUG handshake: p=${clientPrime.toString(16)}, ` +
            `g=${clientGenerator}, clientPub=${clientSharedKey.toString(16)}`);
console.log(`DEBUG keys: aesKey=${aesKey.toString('hex')}, ` +
            `aesIV=${aesIV.toString('hex')}`);
```

**Check server logs:**
```bash
docker logs homed-test-tcp-server | grep DEBUG
```

### Common Issues

**Problem:** "Client null completed handshake"
- **Cause:** Client not sending authorization or server can't decrypt it
- **Check:** IV derivation uses full key, not just first 4 bytes

**Problem:** "JSON parse error"
- **Cause:** Wrong encryption key or IV
- **Check:** Byte order (big-endian), key derivation formula

**Problem:** Empty device list
- **Cause:** Client not authenticated
- **Check:** Token validation, authorization message format

**Problem:** Garbage decrypted data
- **Cause:** Key mismatch or wrong IV derivation
- **Fix:** Ensure IV = MD5(full_aes_key)

### Verification Commands

```bash
# Check authenticated clients
curl http://localhost:8080/test/clients | jq .

# Check server logs for authentication
docker logs homed-test-tcp-server | grep authenticated

# Check client logs
docker logs homed-test-homed-client | grep "Connected to server"

# Run integration tests
npm run test:integration
```

---

## Test Vectors

### Example Handshake Exchange

```
Given:
  p = 1000000007 (0x3B9ACA07)
  g = 5
  client_seed = 42

Client computes:
  A = g^seed mod p = power(5, 42, 1000000007)

Client sends: [0x3B 0x9A 0xCA 0x07] [0x00 0x00 0x00 0x05] [0x?? 0x?? 0x?? 0x??]
              |______ p ________|  |______ g ________|  |______ A ________|

Server computes:
  b = 12345 (server's private key)
  B = g^b mod p = power(5, 12345, 1000000007)

Server sends: [0x?? 0x?? 0x?? 0x??]
              |______ B ________|

Both compute:
  shared_secret = A^b mod p = B^a mod p

Both derive:
  aes_key = MD5(shared_secret as 4-byte big-endian)
  aes_iv = MD5(aes_key)  ← Full 16 bytes
```

### Example Message Framing

```
Plaintext: "test"
After padding: "test\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00" (16 bytes)
After AES: [encrypted 16 bytes]
After framing: 0x42 [escaped_encrypted_bytes] 0x43

If encrypted byte 0x42 appears: becomes 0x44 0x62
If encrypted byte 0x43 appears: becomes 0x44 0x63
If encrypted byte 0x44 appears: becomes 0x44 0x64
```

---

## Conclusion

The HOMEd TCP protocol is a functional but security-limited custom protocol suitable for home automation on trusted networks. The key implementation detail that caused initial issues was the IV derivation - it must use the **entire 16-byte AES key**, not just the first 4 bytes.

**Key Takeaways:**
1. ✅ Protocol fully reverse-engineered and documented
2. ✅ Implementation working with official homed-cloud client
3. ⚠️ Security limitations documented - use only on trusted networks
4. ✅ All quirks and edge cases identified
5. ✅ Complete reference for future implementations

For production systems requiring internet connectivity, strongly consider migrating to TLS 1.3 or a modern authenticated encryption protocol like the Noise Protocol Framework.

---

**Document Version:** 1.0
**Author:** AI Analysis based on u236/homed-service-cloud and homed-server-google
**Status:** Complete - All known aspects documented
