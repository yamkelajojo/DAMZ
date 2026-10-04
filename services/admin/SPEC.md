# Admin Service Specification

**Version**: 1.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

---

## 1. Overview

The Admin service is the **single bounded, Tor-hidden service** (ADR-0001) authoritative for moderation state only:
- Runner registry (approval, bans)
- Customer strikes
- Disputes
- Platform settings

**Hard constraint**: **Holds zero rows of order, message, or proof data.** A startup check enforces this (see §4.2).

**Stack**: Rust + Axum + SQLCipher (via `sqlx` with `sqlcipher` feature) + `arti` for Tor.

---

## 2. Language & Framework

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | Rust | Memory safety, single binary, small attack surface |
| Web framework | Axum | Type-safe, composable, `tower` ecosystem |
| Database | SQLite + SQLCipher (WAL mode) | Embedded, encrypted, compile-time checked via `sqlx` |
| Tor | `arti-client` | Pure Rust Tor implementation, no system dependency |
| Auth | DID-signed requests (Ed25519) | No passwords for API, consistent with DAMZ identity model |
| API style | REST + SSE | Simple, debuggable, works over Tor |

---

## 3. Endpoint List

All endpoints require **DID-signed requests** (Ed25519). Server verifies signature, maps to registry.

### 3.1 Sync Endpoints (Mobile Apps)

| Method | Path | Description | Access |
|--------|------|-------------|--------|
| `GET` | `/sync/strikes?cursor=<opaque>` | Paginated strikes for requesting Customer | Customer (own DID) |
| `GET` | `/sync/settings?cursor=<opaque>` | Paginated platform settings | Both apps |
| `GET` | `/sync/directory?cursor=<opaque>` | Paginated runner directory (discovery) | Both apps |
| `GET` | `/sync/disputes?cursor=<opaque>` | Paginated disputes | Customer: own; Runner: against them |

**Response format**:
```json
{
  "data": [...],
  "cursor": "opaque-string",
  "has_more": true
}
```

### 3.2 Push Endpoint (SSE)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/events` | Server-Sent Events stream |

**Event types**:
- `strike.created` — New strike issued
- `runner.banned` — Runner banned
- `dispute.updated` — Dispute status changed
- `setting.changed` — Platform setting updated

**SSE features**:
- Single persistent connection per app
- Reconnects on Tor circuit rotation
- `Last-Event-ID` header for resume

### 3.3 Write Endpoints

| Method | Path | Description | Actor |
|--------|------|-------------|-------|
| `POST` | `/disputes` | Customer submits draft dispute | Customer |
| `POST` | `/disputes/{id}/proof-key` | Customer shares proof key for admin review | Customer |
| `POST` | `/runners/claim` | Runner claims pre-created registry entry | Runner |
| `GET` | `/runners/me` | Runner checks their registry status | Runner |

### 3.4 Admin CLI Endpoints (Internal Only)

Not exposed via HTTP. Admin uses direct CLI + SQLite:

```bash
# Runner management
cargo run --bin admin-cli -- runner add --did did:key:z6Mk... --onion abc123.onion
cargo run --bin admin-cli -- runner ban --did did:key:z6Mk... --reason "fraud"
cargo run --bin admin-cli -- runner unban --did did:key:z6Mk...

# Strike management
cargo run --bin admin-cli -- strike issue --customer-did did:key:z6Mk... --reason "no_show"
cargo run --bin admin-cli -- strike revoke --id strike-uuid

# Dispute management
cargo run --bin admin-cli -- dispute list --status open
cargo run --bin admin-cli -- dispute view --id dispute-uuid
cargo run --bin admin-cli -- dispute resolve --id dispute-uuid --ruling resolved --notes "..."
cargo run --bin admin-cli -- dispute dismiss --id dispute-uuid --notes "..."

# Settings
cargo run --bin admin-cli -- setting set --key fee_address --value "84Wsptn..."
cargo run --bin admin-cli -- setting set --key min_order_zar --value "50.00"
```

---

## 4. Database Schema

### 4.1 Tables

```sql
-- Exactly one admin (you)
CREATE TABLE admin_identity (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  did           TEXT NOT NULL,
  password_hash TEXT NOT NULL,     -- Argon2id (for CLI login)
  created_at    INTEGER NOT NULL
);

-- Runner registry (pre-created by admin, claimed by runner)
CREATE TABLE runner_registry (
  id             TEXT PRIMARY KEY,           -- runner DID
  runner_did     TEXT NOT NULL,
  display_name   TEXT,
  onion_address  TEXT NOT NULL,
  approved_at    INTEGER,                    -- NULL until claimed
  banned_at      INTEGER,
  ban_reason     TEXT,
  last_active_at INTEGER
  -- NO order counts (ADR-0001)
);

-- Disputes (customer-submitted, admin-adjudicated)
CREATE TABLE disputes (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,               -- Opaque to admin
  customer_did  TEXT NOT NULL,
  runner_did    TEXT NOT NULL,
  reason        TEXT NOT NULL,               -- 'non_delivery' | 'wrong_item' | 'other'
  proof_cid     TEXT,                        -- Only what customer shares
  proof_key     TEXT,                        -- Cleared when dispute closes
  status        TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','dismissed')),
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER,
  admin_notes   TEXT
);

-- Strikes (customer penalties, server-authoritative)
CREATE TABLE strikes (
  id         TEXT PRIMARY KEY,
  subject_did TEXT NOT NULL,                 -- Customer DID
  reason     TEXT NOT NULL,                   -- 'no_show' | 'false_claim' | 'abusive'
  issued_at  INTEGER NOT NULL,
  revoked_at INTEGER,
  notes      TEXT
);

-- Platform settings (key-value)
CREATE TABLE platform_settings (
  id         TEXT PRIMARY KEY,               -- setting key
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 4.2 Bounded-Scope Enforcement

**Startup check** (fails fast if violated):

```rust
async fn enforce_bounded_scope(pool: &SqlitePool) -> Result<(), Error> {
  // Check no foreign keys to order tables exist
  let tables = sqlx::query!("SELECT name FROM sqlite_master WHERE type='table'")
    .fetch_all(pool)
    .await?;
  
  for table in tables {
    let cols = sqlx::query!("PRAGMA table_info(?)", &table.name)
      .fetch_all(pool)
      .await?;
    
    for col in cols {
      // Any column referencing orders, messages, proofs = violation
      if col.name.contains("order_id") || col.name.contains("message_id") || col.name.contains("proof_") {
        if table.name != "disputes" || (col.name != "order_id" && col.name != "proof_cid" && col.name != "proof_key") {
          return Err(Error::BoundedScopeViolation { table: table.name, column: col.name });
        }
      }
    }
  }
  Ok(())
}
```

**Allowed references in admin DB**:
- `disputes.order_id` (opaque, no FK)
- `disputes.proof_cid` (opaque, no FK)
- `disputes.proof_key` (cleared on close)

**Forbidden**: Any table with `customer_did` + `runner_did` + order details beyond what's in `disputes`.

---

## 5. Authentication

### 5.1 Mobile App Requests

All HTTP requests signed by requester's DID:

```typescript
// Client signs request body + timestamp + nonce
const payload = JSON.stringify({ body, timestamp, nonce });
const signature = await didSign(payload); // Ed25519 via @did-tools/key

// Headers
X-DAMZ-DID: did:key:z6Mk...
X-DAMZ-Signature: <base64 signature>
X-DAMZ-Timestamp: 1234567890
X-DAMZ-Nonce: <random>
```

**Server verification**:
1. Parse DID → extract Ed25519 public key
2. Verify signature over `timestamp + nonce + body`
3. Check timestamp within ±5 min (replay protection)
4. Check nonce not seen recently (in-memory set, TTL 10 min)
5. Map DID to registry:
   - Customer DID → allowed `/sync/strikes`, `/disputes`, `/disputes/{id}/proof-key`
   - Runner DID → allowed `/sync/directory`, `/runners/claim`, `/runners/me`

### 5.2 Admin CLI

Local SQLite access + Argon2id password hash in `admin_identity.password_hash`.

---

## 6. Dispute Review Flow

### 6.1 UX (Admin CLI)

```
$ cargo run --bin admin-cli -- dispute list --status open
ID                                  | Customer DID       | Runner DID         | Reason         | Created
------------------------------------|--------------------|--------------------|----------------|------------
dsp_abc123...                       | did:key:z6MkCust...| did:key:z6MkRun... | non_delivery   | 2026-10-01

$ cargo run --bin admin-cli -- dispute view --id dsp_abc123...
Dispute: dsp_abc123...
  Order ID: ord_xyz789... (opaque)
  Customer: did:key:z6MkCust...
  Runner:   did:key:z6MkRun...
  Reason:   non_delivery
  Proof CID: bafybeih... (shared by customer)
  Proof Key: [NOT SHARED]
  Status:   open
  Created:  2026-10-01 14:30:00
  Evidence: [customer's chat screenshots, description]

$ cargo run --bin admin-cli -- dispute request-proof-key --id dsp_abc123...
→ Sends SSE event `dispute.proof_key_requested` to customer's app
→ Customer sees "Admin requests proof key for dispute #dsp_abc123"
→ Customer taps "Share" → app calls POST /disputes/{id}/proof-key

$ cargo run --bin admin-cli -- dispute view --id dsp_abc123...
  Proof Key: a1b2c3d4... (now available)

$ cargo run --bin admin-cli -- dispute decrypt-proof --id dsp_abc123...
→ Downloads encrypted bundle from IPFS (via CID)
→ Decrypts with proof_key
→ Verifies photo attestation (C2PA + device attestation)
→ Verifies ZK location proof
→ Output: "Photo valid. Location proof valid (within 50m)."

$ cargo run --bin admin-cli -- dispute resolve --id dsp_abc123... --ruling resolved --notes "Photo + ZK proof confirm delivery"
→ Status: resolved
→ SSE: dispute.updated to customer + runner
→ Customer can now request refund (runner sends new Monero payment)
```

### 6.2 Proof Key Sharing API

```
POST /disputes/{id}/proof-key
Content-Type: application/json
X-DAMZ-DID: did:key:z6MkCustomer...
X-DAMZ-Signature: ...

{
  "proof_key": "a1b2c3d4e5f6..."  // Base64 encoded 32-byte AES key
}
```

**Server**:
1. Verify requester is the dispute's `customer_did`
2. Store `proof_key` in `disputes.proof_key`
3. SSE push `dispute.proof_key_received` to admin (if admin has SSE open) — or admin polls

**On dispute close** (resolved/dismissed):
- `UPDATE disputes SET proof_key = NULL WHERE id = ?` — key cleared, bundle unreadable

---

## 7. Deployment Guide

### 7.1 Binary

```bash
cargo build --release -p damz-admin
# Binary: target/release/damz-admin (~5 MB static)
```

### 7.2 Tor Hidden Service

Via `arti` (preferred) or system Tor. Single process, single binary.

### 7.3 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_PORT` | No (default 3002) | HTTP port |
| `DATABASE_URL` | Yes | `sqlite:///var/lib/damz/admin.db?cipher=sqlcipher` |
| `DB_ENCRYPTION_KEY` | Yes | 32-byte hex (from `age`-encrypted file at deploy) |
| `ADMIN_DID` | Yes | Admin's `did:key` |
| `ADMIN_PASSWORD_HASH` | Yes | Argon2id hash for CLI login |
| `RELAY_ONION_URL` | Yes | For dispute notifications |
| `IPFS_GATEWAY_URL` | Yes | For proof bundle retrieval (Meshkit/MinIO .onion) |
| `RUST_LOG` | No | Logging level |

### 7.4 Systemd Service

```ini
[Unit]
Description=DAMZ Admin Service
After=network-online.target tor.service
Wants=tor.service

[Service]
Type=simple
User=damz-admin
ExecStart=/opt/damz/admin/damz-admin
EnvironmentFile=/etc/damz/admin.env
Restart=on-failure
RestartSec=5
MemoryMax=256M
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
```

### 7.5 Backup

```bash
# Daily cron (encrypted)
sqlite3 /var/lib/damz/admin.db ".backup /backup/admin-$(date +%F).db"
age -e -r <admin-backup-key> /backup/admin-$(date +%F).db > /backup/admin-$(date +%F).db.age
```

---

## 8. Testing

### 8.1 Unit Tests
- DID signature verification
- Sync cursor pagination
- Dispute state machine
- Bounded-scope startup check

### 8.2 Integration Tests
- Full sync flow (app → admin → app)
- Dispute submission → proof key share → decryption → ruling
- Runner claim flow
- SSE reconnection on Tor rotation

### 8.3 Contract Tests
- OpenAPI spec at `/openapi.json` validated in CI
- Request/response schema validation

---

## 9. Open Questions

- **OQ-ADMIN-001**: Should admin service expose a minimal read-only HTTP dashboard (for debugging)? Currently CLI-only.
- **OQ-ADMIN-002**: Dispute timeout (14 days) — implemented as cron job in admin service or external? Current: external cron (simpler).
- **OQ-ADMIN-003**: Runner strike threshold (3 = ban) — configurable via `platform_settings`? Current: hardcoded, can be made configurable.