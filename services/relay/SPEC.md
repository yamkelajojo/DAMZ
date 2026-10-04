# Relay Service Specification

**Version**: 1.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

---

## 1. Overview

The relay is a discardable, minimal Tor-hidden service that accepts encrypted blobs, stores them in memory with TTL, and forwards on retrieval. No logs, no persistence, no identity mapping. Multiple community instances can run the same binary.

**Design Principles**:
- **Zero knowledge**: Relay sees only encrypted blobs + recipient onion hashes
- **Ephemeral**: In-memory only, no disk persistence
- **Replaceable**: Any community member can deploy; clients discover via IPNS
- **Minimal**: ~200 lines Rust (Axum + Tokio + Arti)

---

## 2. Protocol Definition

### 2.1 Endpoints

#### Store Blob
```
PUT /blob/{recipient_onion_hash}
```
- **Path parameter**: `recipient_onion_hash` = SHA256(recipient_tor_public_key) (32 bytes, hex encoded)
- **Headers**:
  - `X-Expiry`: TTL in seconds (required)
  - `Content-Type`: `application/octet-stream`
- **Body**: Encrypted blob (Signal Protocol envelope, max 64 KB)
- **Response**: `202 Accepted`
  ```json
  { "blob_id": "uuid-v4", "expires_at": 1234567890 }
  ```
- **Error codes**:
  - `400 Bad Request`: Missing X-Expiry, blob too large (>64KB), invalid onion hash format
  - `413 Payload Too Large`: Blob exceeds 64 KB limit
  - `503 Service Unavailable`: Memory queue full (backpressure)

#### Retrieve Blob
```
GET /blob/{blob_id}
```
- **Path parameter**: `blob_id` (UUIDv4 returned from PUT)
- **Response**: `200 OK`
  - Body: Encrypted blob (same bytes as PUT)
  - Headers: `Content-Type: application/octet-stream`
- **Behavior**: Blob is **deleted immediately after successful retrieval** (or after expiry)
- **Error codes**:
  - `404 Not Found`: Blob ID not found or already retrieved/expired
  - `410 Gone`: Blob expired before retrieval

### 2.2 Message Format

The relay is agnostic to the blob content. For DAMZ, blobs are Signal Protocol envelopes:

```
Blob = Signal Protocol Envelope (ciphertext + metadata)
Max size: 64 KB
```

### 2.3 Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Recipient ID | SHA256(Tor public key) | Relay cannot map to identity |
| Chat message TTL | 24h (86,400s) | Covers offline delivery window |
| Proof key TTL | 7d (604,800s) | Allows delayed proof retrieval |
| Blob size limit | 64 KB | Covers Signal envelope + proof key |
| Max concurrent blobs | 10,000 per relay | Memory bound (~640 MB worst case) |
| Padding | None (v1) | Metadata leak acceptable for v1 |

---

## 3. Failure Modes

| Scenario | Behavior |
|----------|----------|
| Relay restarts mid-delivery | All in-memory blobs lost. Senders retry with exponential backoff (1s, 2s, 4s... max 60s, jitter ±10%). Recipients never receive — sender must re-send. |
| Queue full (10,000 blobs) | Return `503 Service Unavailable`. Client retries with backoff. |
| Blob expires before retrieval | Return `410 Gone` on GET. Sender notified via application-layer timeout. |
| Network partition | Tor handles circuit rotation. Client detects via control port, re-establishes connections. |
| Malicious relay | Sees only encrypted blobs + recipient onion hashes. Cannot decrypt, cannot link sender/recipient beyond timing correlation. |

---

## 4. Horizontal Scaling

**Multiple relays are independent** — no coordination, no shared state.

- **Discovery**: 3 relays published via IPNS (interplanetary naming system). Clients fetch relay list on startup.
- **Load balancing**: Round-robin with failover. Client tries relay 1, on failure tries relay 2, then relay 3.
- **No replication**: Blobs are not replicated across relays. If relay 1 loses a blob, relay 2 doesn't have it. Sender must re-send to another relay.
- **No clustering**: Each relay is a standalone process. Adding capacity = deploy more relays, update IPNS record.

---

## 5. Deployment Guide

### 5.1 Binary

```bash
# Build
cargo build --release -p damz-relay

# Binary: target/release/damz-relay (~3 MB static)
```

### 5.2 Tor Hidden Service

Run as Tor onion service (via `arti` or system Tor):

**torrc** (if using system Tor):
```
HiddenServiceDir /var/lib/tor/relay/
HiddenServicePort 80 127.0.0.1:3000
```

**arti** (programmatic, preferred):
```rust
use arti_client::{TorClient, TorClientConfig};
// Configure and bootstrap, then bind Axum to the Tor listener
```

### 5.3 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELAY_PORT` | No | 3000 | HTTP port (inside Tor) |
| `MAX_BLOBS` | No | 10000 | Max concurrent blobs in memory |
| `MAX_BLOB_SIZE` | No | 65536 | Max blob size in bytes (64 KB) |
| `DEFAULT_TTL_CHAT` | No | 86400 | Default TTL for chat messages (seconds) |
| `DEFAULT_TTL_PROOF` | No | 604800 | Default TTL for proof keys (seconds) |
| `RUST_LOG` | No | info | Logging level (no sensitive data logged) |

### 5.4 Systemd Service (Example)

```ini
[Unit]
Description=DAMZ Discardable Relay
After=network-online.target tor.service
Wants=tor.service

[Service]
Type=simple
User=damz-relay
ExecStart=/opt/damz/relay/damz-relay
Environment=RELAY_PORT=3000
Environment=RUST_LOG=info
Restart=on-failure
RestartSec=5
MemoryMax=1G
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
```

### 5.5 Health Check

```
GET /health
Response: 200 OK, { "status": "ok", "blobs_in_memory": 42 }
```

---

## 6. Security Considerations

- **No logging**: Zero log output for blob operations. Only startup/shutdown and error counts.
- **No metrics**: No Prometheus, no telemetry. Relay is a black box.
- **Memory only**: Uses `HashMap<BlobId, BlobEntry>` with TTL sweep every 60s.
- **Constant-time operations**: Blob retrieval/delete uses constant-time map access.
- **Tor isolation**: Each relay runs on separate VPS, separate Tor circuit.
- **No authentication**: By design — anyone can PUT/GET. Rate limiting only by IP (Tor exit) at network level.

---

## 7. Testing

### 7.1 Unit Tests
- TTL expiration logic
- Blob size validation
- Onion hash format validation
- Memory eviction under pressure

### 7.2 Integration Tests
- PUT → GET round-trip over local Tor
- Concurrent PUT/GET from multiple clients
- Relay restart survival (client retry logic)
- Expiry behavior (TTL sweep)

### 7.3 Contract Tests
- JSON Schema validation for PUT/GET request/response
- OpenAPI spec compliance (if REST wrapper added)

---

## 8. Open Questions

- **OQ-RELAY-001**: Should we add fixed-size padding (e.g., all blobs padded to 64 KB) in v1 to reduce metadata leakage? Currently deferred to v2.
- **OQ-RELAY-002**: Should relay support WebSocket for lower-latency delivery? Currently HTTP-only for simplicity.
- **OQ-RELAY-003**: What is the exact IPNS key management process for community relay discovery? Needs documentation in `DEPLOYMENT.md`.