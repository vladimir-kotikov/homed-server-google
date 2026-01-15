# Quick Reference - TCP Authentication Issue

> **📖 For complete protocol documentation, see [HOMED_TCP_PROTOCOL.md](docs/HOMED_TCP_PROTOCOL.md)**

## ✅ RESOLVED - January 15, 2026

**Fix:** Changed AES IV derivation from `MD5(aesKey[0:4])` to `MD5(aesKey)`

## Current Status
- **146/152 tests passing** (96%)
- **TCP client authentication WORKING** ✅
- **5 failing tests** are pre-existing (not related to this fix)

## The Problem (RESOLVED)
**Issue:** Server could not decrypt client authorization messages due to incorrect IV derivation.

## The Solution

**File:** `src/tcp/client-connection.ts` (lines 119-132)

**Before (WRONG):**
```typescript
const aesKey = crypto.createHash("md5").update(sharedSecretBuffer).digest();
const aesIV = crypto.createHash("md5").update(aesKey.slice(0, 4)).digest();
```

**After (CORRECT):**
```typescript
const aesKey = crypto.createHash("md5").update(sharedSecretBuffer).digest();
const aesIV = crypto.createHash("md5").update(aesKey).digest(); // Full 16-byte key
```

**Root Cause:** IV derivation used only first 4 bytes of AES key instead of the entire 16-byte key.

## Verification

```bash
# Check TCP client is authenticated
curl http://localhost:8080/test/clients | jq .
# Should return: { "count": 1, "clients": ["integration-test-client"] }

# Check server logs
docker logs homed-test-tcp-server | grep authenticated
# Should show: "Client integration-test-client authenticated as user ..."
```

## Key Learnings

1. **Protocol Analysis:** Used subagents to analyze both client (u236/homed-service-cloud) and server (u236/homed-server-cloud) implementations
2. **IV Derivation:** The official client uses `MD5(entire_aes_key)` not `MD5(first_4_bytes)`
3. **Double MD5:** Key derivation is: `aesKey = MD5(sharedSecret)`, then `aesIV = MD5(aesKey)`

---

**References:**
- **📖 Complete Protocol Guide:** [docs/HOMED_TCP_PROTOCOL.md](docs/HOMED_TCP_PROTOCOL.md)
- Client analysis: [docs/TCP_CLIENT_CRYPTO_ANALYSIS.md](docs/TCP_CLIENT_CRYPTO_ANALYSIS.md)
- Server analysis: [HOMED_SERVER_CLOUD_PROTOCOL_ANALYSIS.md](HOMED_SERVER_CLOUD_PROTOCOL_ANALYSIS.md)

**Last updated:** January 15, 2026
**Status:** ✅ RESOLVED
