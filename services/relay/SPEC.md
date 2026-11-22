# Relay Service Specification

**Version**: 1.1
**Status**: Approved
**Last Updated**: 2026-11-22
**Owner**: Admin/Developer

---

## 1. Overview

The relay is a discardable, minimal HTTP service designed to sit behind a separately managed Tor onion service. It accepts encrypted blobs, stores them in bounded memory with TTL, and forwards them on retrieval. It has no disk persistence or identity mapping. Multiple community instances can run the same binary.

**Design Principles**:
- **Zero knowledge**: Relay sees only encrypted blobs + recipient onion hashes
- **Ephemeral**: In-memory only, no disk persistence
- **Replaceable**: Any community member can deploy; clients discover via IPNS
- **Minimal**: bounded in-memory Axum service; Tor is configured separately

---

## 2. Protocol Definition

### 2.1 Endpoints

#### Store Blob
```
PUT /blob/{recipient_onion_hash}
```
- **Path parameter**: `recipient_onion_hash` = SHA256(recipient_tor_public_key) (32 bytes, hex encoded)
- **Headers**:
  - `X-Expiry`: TTL in seconds (required; from 1 through `MAX_TTL_SECONDS`)
  - `Content-Type`: `application/octet-stream`
- **Body**: Already encrypted application envelope (max `MAX_BLOB_SIZE`)
- **Response**: `202 Accepted`
  ```json
  { "blob_id": "uuid-v4", "expires_at": 1795392000 }
  ```
- **Error codes**:
  - `400 Bad Request`: Missing/invalid X-Expiry or recipient hash
  - `413 Payload Too Large`: Blob exceeds `MAX_BLOB_SIZE`
  - `503 Service Unavailable`: A global, per-recipient, or total-byte limit is full

#### Pull Recipient Inbox
```
GET /inbox/{recipient_onion_hash}
```
- Uses the same SHA256 recipient hash supplied to `PUT /blob/{recipient_onion_hash}`.
- Returns the oldest unexpired blob without deleting it.
- **Response**: `200 OK`, JSON with `blob_id` and `payload_base64` fields. The
  decoded payload is the original opaque encrypted blob.
- **Empty response**: `204 No Content` when no pending blob exists.
- The recipient hash is an address, not a secret. The relay does not authenticate
  pollers; end-to-end encryption protects message contents.

#### Acknowledge Inbox Blob
```
POST /inbox/{recipient_onion_hash}/ack/{blob_id}
```
- The recipient acknowledges only after authenticating and durably handling
  the blob. The relay deletes it only if the ID belongs to that recipient.
- **Response**: `204 No Content`, including for an unknown ID or an ID belonging
  to a different recipient, so the endpoint does not reveal queue membership.
- The relay redelivers until acknowledgement, keeping the unacknowledged item
  at the front of the FIFO queue.
  A recipient crash before its database commit or acknowledgement causes
  redelivery; the app's durable event-ID store makes that redelivery safe.
- A poller that knows the public recipient hash can read the returned blob ID
  and issue an acknowledgement, so this does not authenticate pollers or protect
  availability against an active attacker. Relay restarts also lose all
  in-memory items.

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
  - `404 Not Found`: Blob ID is unknown, already retrieved, or was removed by expiry cleanup
  - `410 Gone`: Blob is expired and still present when retrieval is attempted

### 2.2 Message Format

The relay is agnostic to the blob content. DAMZ sends end-to-end encrypted
application envelopes through it:

```
Chat: Signal Protocol envelope
Payment notification: HPKE Auth envelope
Max size: 64 KB
```

The mobile `RelayClient` sends an already encrypted envelope over the app's Tor
HTTP client, polls the recipient inbox, and acknowledges only after the caller
has durably handled the returned blob. It does not encrypt or decrypt. Relay
requests must target an onion-service URL; the client rejects clearnet relay
URLs. The envelope remains opaque to the relay and is transported as a UTF-8
string by the current native Tor API.

### 2.3 Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Recipient ID | SHA256(Tor public key) | Relay cannot map to identity |
| Chat message TTL | 24h (86,400s) | Covers offline delivery window |
| Proof key TTL | 7d (604,800s) | Allows delayed proof retrieval |
| Blob size limit | 64 KB | Covers encrypted chat and payment envelopes |
| Max concurrent blobs | 10,000 per relay | Bounds queued blob count |
| Max blobs per recipient | 1,000 | Prevents one inbox from using every blob slot |
| Max total in-memory payload | 256 MiB | Hard byte bound independent of blob count |
| Max blob TTL | 7 days | Limits retention even if a client requests a long expiry |
| Padding | None (v1) | Metadata leak acceptable for v1 |

---

## 3. Failure Modes

| Scenario | Behavior |
|----------|----------|
| Relay restarts mid-delivery | All in-memory blobs are lost, including unacknowledged items. A sender must enqueue again; the current relay has no persistence or replication. |
| Queue full (global, per-recipient, or byte limit) | Return `503 Service Unavailable`. Client retries with backoff. |
| Blob expires before retrieval | Return `410 Gone` on GET. Sender notified via application-layer timeout. |
| Network partition | The native Tor transport reports request failures. Runner retries inbox polling after 30 seconds and when foregrounded; an enqueue caller must retry with a newly signed callback nonce. Control-port circuit detection is not implemented. |
| Malicious relay | Sees only encrypted blobs + recipient onion hashes. Cannot decrypt, cannot link sender/recipient beyond timing correlation. |

---

## 4. Horizontal Scaling

Each `RelayClient` currently targets one configured relay URL. IPNS discovery,
client-side multi-relay failover, replication, and clustering are not
implemented. A relay restart loses its in-memory queue; the sender must enqueue
again through its application-level retry path.

---

## 5. Deployment Guide

### 5.1 Binary

```bash
# Build
cargo build --release -p damz-relay

# Binary: target/release/damz-relay (~3 MB static)
```

### 5.2 Tor Hidden Service

The relay currently expects a separately managed system Tor onion service that
forwards to its loopback HTTP port. The Rust process does not bootstrap or
control Tor itself.

**torrc**:
```
HiddenServiceDir /var/lib/tor/relay/
HiddenServicePort 80 127.0.0.1:3000
```

Arti integration is not implemented. Do not treat the service as onion-hidden
until the system Tor mapping is configured and verified in deployment.

### 5.3 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELAY_PORT` | No | 3000 | HTTP port (inside Tor) |
| `MAX_BLOBS` | No | 10000 | Max concurrent blobs in memory |
| `MAX_BLOBS_PER_RECIPIENT` | No | 1000 | Max pending blobs for one recipient hash |
| `MAX_BLOB_SIZE` | No | 65536 | Max blob size in bytes (64 KB) |
| `MAX_TOTAL_BYTES` | No | 268435456 | Max total payload bytes in memory (256 MiB) |
| `MAX_TTL_SECONDS` | No | 604800 | Max accepted `X-Expiry` TTL (7 days) |
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
Response: 200 OK, { "status": "ok", "blobs_in_memory": 42, "bytes_in_memory": 2048 }
```

---

## 6. Security Considerations

- **No logging**: No request tracing or blob-operation logging. Only startup/shutdown messages.
- **No metrics**: No Prometheus, no telemetry. Relay is a black box.
- **Memory only**: Uses `HashMap<BlobId, BlobEntry>` with TTL sweep every 60s.
- **Bounded memory**: Blob count, per-recipient count, total payload bytes, blob size, and TTL have configured limits.
- **Tor isolation**: Each relay runs on separate VPS, separate Tor circuit.
- **No authentication**: By design — anyone can PUT/GET. Rate limiting only by IP (Tor exit) at network level.

---

## 7. Testing

### 7.1 Unit Tests
- Recipient inbox returns matching FIFO blobs and redelivers until acknowledgement
- Acknowledgement deletes only the matching recipient's blob
- Direct UUID retrieval removes a blob from its recipient inbox
- TTL expiry removes blobs and releases queue/byte capacity
- Blob size, TTL, and recipient hash validation
- Global capacity remains correct under concurrent PUTs

### 7.2 Integration Tests
- PUT → GET → acknowledge round-trip over local Tor
- Recipient crash before acknowledgement receives the same blob again
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
