# Admin Service Specification

**Version**: 1.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

---

## 1. Overview

The Admin service is the **single bounded, Tor-hidden service** (ADR-0001) authoritative for:
- Runner registry (approval, bans)
- Customer strikes
- Disputes
- Platform settings
- Minimal command metadata for best-effort DAMZ app-data wipes on verified managed Android installations only (ADR-0029)

**Hard constraint**: **Holds zero rows of order, message, or proof data.** It is not a central user database; the sole additional device data is a pseudonymous target app DID in a bounded wipe command. A startup check enforces the content boundary (see §4.2).

The six Admin tables specified in §4 are a separate Rust/SQLite schema, not part of the
19-table client-side WatermelonDB schema. `wipe_pending` is Admin-only control metadata;
no corresponding client table is added. Similarly named client mirrors are separate
records; the Admin API contract, rather than a shared mobile schema, connects them
(ADR-0007, ADR-0029, ADR-0043).

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
| `GET` | `/sync/wipe` | At most one target-bound pending app-data wipe command | Verified managed Android Customer/Runner installation only |

The wipe endpoint returns a command only when the authenticated DID and app role match an
unexpired `wipe_pending` row and the installation's managed-Android eligibility is
verified. iOS and unmanaged Android do not receive wipe commands.

**Paginated sync response format**:
```json
{
  "data": [...],
  "cursor": "opaque-string",
  "has_more": true
}
```

`GET /sync/wipe` is a one-command endpoint rather than a mirror feed: it returns the single
active signed command for the matching target DID/app, or an empty result. The database
allows at most one `pending` or `accepted` command per target.

```json
{
  "id": "wipe-random-id",
  "target_did": "did:key:z6Mk...",
  "target_app": "customer",
  "scope": "app_data",
  "issued_at": 1791093600,
  "expires_at": 1791352800,
  "nonce": "one-time-random-value",
  "command_signature": "<Admin Ed25519 signature>"
}
```

The target acknowledges only its own command:

```json
{ "status": "accepted", "nonce": "one-time-random-value" }
{ "status": "completed", "nonce": "one-time-random-value" }
```

The signed acknowledgement uses the existing target-DID request headers. `completed` is
sent after the local native handler succeeds and before the remaining DID credential is
deleted; an unsuccessful or unsent receipt is never synthesized by the server.

### 3.2 Push Endpoint (SSE)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/events` | Server-Sent Events stream |

**Event types**:
- `strike.created` — New strike issued
- `runner.banned` — Runner banned
- `dispute.updated` — Dispute status changed
- `setting.changed` — Platform setting updated
- `wipe.pending` — A target-bound managed-Android app-data wipe command is available

The SSE event is only a wake-up hint; the app must also check for commands on startup and
resume. The command itself is fetched over the signed `/sync/wipe` endpoint.

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
| `POST` | `/sync/wipe/{id}/ack` | Target installation reports `accepted` or `completed` for its own command | Verified managed Android target only |

The acknowledgement request is signed by the target DID and must match the command's DID,
app role, ID, nonce, and state transition. `completed` is an app-reported native-handler
result, not third-party proof of physical erasure.

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

# Managed Android: erase DAMZ app data and keys only (never factory-reset the device)
cargo run --bin admin-cli -- wipe issue --target-did did:key:z6Mk... --app customer --reason security_incident --confirm-target did:key:z6Mk...
cargo run --bin admin-cli -- wipe list --status pending
cargo run --bin admin-cli -- wipe cancel --id wipe-uuid
```

Wipe issuance is accepted only after Admin re-authentication, explicit typed confirmation
of the exact target DID/app, and verified Android management enrollment. A caller-provided
boolean alone is not enrollment proof. The command is signed with the Admin Ed25519 key;
that private key is kept outside the Admin database and repository.

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

-- Admin-only, target-bound, expiring DAMZ app-data wipe jobs (ADR-0029)
CREATE TABLE wipe_pending (
  id                 TEXT PRIMARY KEY,
  target_did         TEXT NOT NULL,          -- pseudonymous app-installation DID
  target_app         TEXT NOT NULL CHECK (target_app IN ('customer', 'runner')),
  scope              TEXT NOT NULL DEFAULT 'app_data' CHECK (scope = 'app_data'),
  reason_code        TEXT NOT NULL CHECK (
    reason_code IN ('device_lost', 'device_retired', 'security_incident')
  ),
  nonce              TEXT NOT NULL UNIQUE,
  issued_at          INTEGER NOT NULL, -- UTC Unix seconds
  expires_at         INTEGER NOT NULL, -- UTC Unix seconds
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'completed', 'cancelled', 'expired')),
  accepted_at        INTEGER,          -- UTC Unix seconds
  completed_at       INTEGER,          -- UTC Unix seconds
  requested_by       TEXT NOT NULL,    -- Admin DID
  command_signature  TEXT NOT NULL
);

CREATE INDEX idx_wipe_pending_target
  ON wipe_pending(target_did, target_app, status, expires_at);

CREATE UNIQUE INDEX idx_one_active_wipe_per_target
  ON wipe_pending(target_did, target_app)
  WHERE status IN ('pending', 'accepted');
```

A `pending` or `accepted` command expires no later than 72 hours after issue. The Admin
expiry job transitions any unfinished command to `expired`, so an accepted-but-interrupted
job cannot block a later command forever. Admin may cancel only `pending` commands; an
accepted wipe cannot be revoked. Expired or cancelled commands are never redelivered;
terminal command metadata is purged from the live table no later than 30 days after its
terminal transition. Encrypted backup snapshots may retain earlier copies until the finite
backup-retention policy is resolved (OQ-SEC-WIPE-003). The `completed` state records only
the target app's signed report.

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
- `wipe_pending.target_did` (pseudonymous app-installation target only; no user profile or device hardware identifier)

`wipe_pending` may contain only the command metadata defined in ADR-0029. It must not
contain order, message, proof, location, wallet, contact, or exported user content. The
bounded-scope startup check must explicitly permit this table while continuing to reject
order/message/proof columns outside their current dispute exceptions.

**Forbidden**: Any table with `customer_did` + `runner_did` + order details beyond what's in `disputes`.

---

## 5. Authentication

### 5.1 Mobile App Requests

All HTTP requests signed by requester's DID:

```typescript
// Standard request: sign body + timestamp + nonce.
const payload = JSON.stringify({ body, timestamp, nonce });
const signature = await didSign(payload); // Ed25519 via @did-tools/key

// For /sync/wipe and its acknowledgement, app role is included in the signed payload:
const wipePayload = JSON.stringify({ body, timestamp, nonce, app_role: 'customer' });
const wipeSignature = await didSign(wipePayload);

// Headers
X-DAMZ-DID: did:key:z6Mk...
X-DAMZ-Signature: <base64 signature>
X-DAMZ-Timestamp: 1234567890
X-DAMZ-Nonce: <random>
X-DAMZ-App: customer  // wipe endpoints only; must equal signed app_role
```

**Server verification**:
1. Parse DID → extract Ed25519 public key
2. Verify the standard signature over `timestamp + nonce + body`; for wipe routes, also verify the signed `app_role` equals `X-DAMZ-App`
3. Check timestamp within ±5 min (replay protection)
4. Check nonce not seen recently (in-memory set, TTL 10 min)
5. Map the DID and, on wipe routes, the signed `X-DAMZ-App` role to allowed operations:
   - Customer DID/role → `/sync/strikes`, `/disputes`, `/disputes/{id}/proof-key`, and target-matched `/sync/wipe`
   - Runner DID/role → `/sync/directory`, `/runners/claim`, `/runners/me`, and target-matched `/sync/wipe`
6. For `/sync/wipe`, additionally verify target DID/app role, verified managed-Android enrollment, Admin command signature, expiry, and one-time nonce. Only the matching target may acknowledge that command.

### 5.2 Admin CLI

Local SQLite access + Argon2id password hash in `admin_identity.password_hash`. Wipe issuance additionally requires fresh CLI authentication, explicit target confirmation, verified Android management enrollment, and an Admin-Ed25519-signed command. The signing private key is kept outside the database and repository; the public Admin DID is pinned by the mobile app.

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
| `ADMIN_DID` | Yes | Admin's `did:key` and public command-verification key |
| `ADMIN_PASSWORD_HASH` | Yes | Argon2id hash for CLI login |
| `ADMIN_SIGNING_KEY_PATH` | Required by local `admin-cli` for wipe issuance; not mounted in the web-service process | Operator-protected Ed25519 private key file; never stored in the database or repository |
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

Encrypted snapshots can retain terminal `wipe_pending` metadata after the live row is purged.
The production retention/rotation limit must be finite and is tracked as OQ-SEC-WIPE-003.

---

## 8. Testing

### 8.1 Unit Tests
- DID signature verification
- Sync cursor pagination
- Dispute state machine
- Wipe-command signature, target/app binding, expiry, nonce replay, and legal state transitions
- Bounded-scope startup check, including the narrowly permitted `wipe_pending` columns

### 8.2 Integration Tests
- Full sync flow (app → admin → app)
- Dispute submission → proof key share → decryption → ruling
- Runner claim flow
- Managed-Android wipe issue → target-only retrieval → acceptance/completion ack → terminal-row retention/purge
- Reject iOS, unmanaged Android, wrong-DID/app, expired, cancelled, and replayed wipe commands
- SSE reconnection on Tor rotation and startup/resume polling fallback

### 8.3 Contract Tests
- OpenAPI spec at `/openapi.json` validated in CI
- Request/response schema validation for wipe command and acknowledgement
- Verify `wipe_pending` is Admin-only and does not change the 19-table client schema

---

## 9. Open Questions

- **OQ-ADMIN-001**: Should admin service expose a minimal read-only HTTP dashboard (for debugging)? Currently CLI-only.
- **OQ-ADMIN-002**: Dispute timeout (14 days) — implemented as cron job in admin service or external? Current: external cron (simpler).
- **OQ-ADMIN-003**: Runner strike threshold (3 = ban) — configurable via `platform_settings`? Current: hardcoded, can be made configurable.
- **OQ-SEC-WIPE-001/002/003**: Managed-Android enrollment proof, native app-data deletion validation, and finite encrypted-backup retention. Owners, target phases, and gates are recorded in ADR-0029; no production wipe issuance is allowed until the enrollment-proof question is resolved.