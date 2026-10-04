# ADR-0029: Relay Protocol Specification

**Status**: Accepted

## Context

The discardable relay needs a precise protocol definition for interoperability and testing.

## Decision

Full message format for the discardable relay.

## Consequences

**Protocol**:

```
PUT /blob/{recipient_onion_hash}
  Body: encrypted_blob (Signal Protocol envelope)
  Headers: X-Expiry (seconds)
  Response: 202 Accepted, {blob_id, expires_at}

GET /blob/{blob_id}
  Response: 200 OK, encrypted_blob
  (Blob deleted after retrieval or expiry)
```

**Parameters**:
- **Recipient ID**: `recipient_onion_hash = SHA256(recipient_tor_public_key)` (full 32 bytes, hex encoded)
- **TTL**: Chat messages = 24h (86400s), Proof keys = 7d (604800s)
- **Ordering**: No FIFO guarantee. Apps handle via sequence numbers in Signal envelope.
- **Retry/Backoff**: Exponential: 1s, 2s, 4s, 8s, 16s, 32s, max 60s. Jitter ±10%.
- **Multiple relays**: 3 relays discovered via IPNS. Round-robin with failover.
- **Blob size limit**: 64 KB max (covers Signal envelope + proof key)
- **Padding**: No fixed-size padding in v1 (metadata leak acceptable for v1)

**Security**: Relay sees only encrypted blobs + recipient onion hashes. No identities, no plaintext.