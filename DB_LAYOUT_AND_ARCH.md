# DAMZ — Database Layout & Architecture (v2)

**Version**: 2.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

**Supersedes**: v1 of this document, and Part I of `DB_ARC_and_TEST_PLANNING.md`.
Part II (Testing Strategy) of that document is unaffected.
**Authority**: every decision here is recorded with its rationale in `REFINEMENT_SESSION.md`;
the two hardest ones are ADR-0003 and ADR-0004.

---

## 0. What changed from v1

| # | v1 said | v2 says | Decided in |
|---|---------|---------|------------|
| 1 | Three separate databases with overlapping `orders` / `messages` | **One schema package**, role-scoped writes, two install sets | Q3, Q13 |
| 2 | Two different `orders` tables (customer's and runner's) | **One wide `orders` table**; each device writes only its own columns | Q13 |
| 3 | "No central database server" *and* a server-side admin DB | One bounded admin service (ADR-0001), **SQLite + SQLCipher** | Q2, Q7, Q18 |
| 4 | Strikes local on the device, admin issues them | Strikes **server-authoritative**, device keeps a read-only mirror | Q7, Q11 |
| 5 | Proof key = HKDF from an undefined `masterKey` | **Random key per order**, sent over the order chat | Q12, ADR-0003 |
| 6 | Prices unmodelled (customer pays a total from nowhere) | Runner **publishes a signed price list**; the order freezes a snapshot | Q14, ADR-0004 |
| 7 | Catalog = 7 rows *with prices*, owned by the runner | `catalog_items` (fixed 7, read-only) + `price_lists` / `runner_prices` | Q14 |
| 8 | Messages store the Signal envelope; 90-day retention | Messages store the **decrypted body**; envelope only until sent; **30 days** | Q15, Q9 |
| 9 | Purge ran `unsafeResetDatabase()`, commented "VACUUM" | Purge is a real `DELETE` + `VACUUM`; that call would have **wiped the database** | Q9 |
| 10 | Delivery address columns on both orders tables | **No address column** — the address exists only in the order chat | Q6, Q20 |
| 11 | `wallet_metadata` on the Customer app | Wallet belongs to the **Runner**, who is the payee | Q22 |
| 12 | `runner_registry.total_orders_completed` | **Dropped** — counting orders requires holding order data (ADR-0001) | Q7 |

---

## 1. How to read this schema

There are two apps and one service:

- **Customer app** (`apps/customer`) — places orders, pays, confirms delivery, converts ZAR→XMR (XmrBazaar/Haveno/UnstoppableSwap).
- **Runner app** (`apps/runner`) — publishes a price list, accepts and fulfils orders, converts XMR→ZAR (Haveno).
- **Admin service** (`services/admin`, Tor-hidden) — the only server. Registry, bans,
  strikes, disputes, settings. It never holds order, chat, or proof content (ADR-0001).

The client-side WatermelonDB schema contains **19 tables** (listed in §§2–4).
`packages/db` defines that client schema; each app installs its required table set, and
each device writes only the columns it owns. The Admin service keeps a separate Rust/SQLite
schema (see §8), not a third mobile install set. Domain concepts mirrored between client
and server are separate stored records; the service contract is defined by ADR-0007.
Every client table below is annotated with who writes it:

> **✍️ Owner** — the device allowed to write a column or table.
> **👁️ Mirror** — read-only on the device; the admin service is the source of truth.

**Constraints that shaped the DDL**

- WatermelonDB requires a single string `id` primary key per table — no composite keys.
  Where a natural composite key exists, it is expressed as a `UNIQUE` constraint and the
  `id` is the two parts joined.
- WatermelonDB does not enforce foreign keys; the `REFERENCES` clauses document intent and
  are enforced by the query layer, not the engine.
- Money is always a **decimal string** (`'15.00'`), never a float.

---

## 2. Identity, contacts, catalog

```sql
-- Exactly one row per device: this device's own persona.
-- ✍️ Owner: the device itself (both apps).
CREATE TABLE identity (
  id                TEXT PRIMARY KEY,        -- the DID; one row per install
  did               TEXT NOT NULL,           -- did:key:z6Mk...  (ADR-0002)
  display_name      TEXT,                    -- pseudonym
  public_key        BLOB NOT NULL,           -- Ed25519 public half
  default_radius_km REAL,                    -- Customer: search radius
  is_available      INTEGER,                 -- Runner only: accepting orders?
  onion_address     TEXT,                    -- Runner: own hidden service
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
```

Private keys (DID, Signal identity, wallet seed) never enter this database — they live in
`expo-secure-store` (see §7).

```sql
-- People this device has dealt with. ✍️ Owner: the device.
-- Keyed by DID, not by Signal address: the DID is the durable identity.
CREATE TABLE contacts (
  id                  TEXT PRIMARY KEY,      -- the DID
  did                 TEXT NOT NULL,
  display_name        TEXT,
  onion_address       TEXT,
  signal_address      TEXT,                  -- Signal ProtocolAddress (name+deviceId)
  signal_identity_key BLOB,
  last_seen_at        INTEGER,
  blocked             INTEGER NOT NULL DEFAULT 0,  -- local block, never published
  created_at          INTEGER NOT NULL
);
```

```sql
-- The fixed eight-item catalog. Seeded at install, never written by anyone.
-- ✍️ Owner: the app bundle. 👁️ Both apps.
CREATE TABLE catalog_items (
  id           TEXT PRIMARY KEY,             -- 'cabbage', 'spinach', 'cinnamon', 'cauliflower', 'rock_salt', 'flour', 'bicarbonate_of_soda', 'grape_soda'
  display_name TEXT NOT NULL,                -- 'Cabbage', 'Spinach', 'Cinnamon', 'Cauliflower', 'Rock Salt', 'Flour', 'Bicarbonate of Soda', 'Grape Soda (Small Bottle)'
  sort_order   INTEGER NOT NULL
);
```

### The published price list

A Runner publishes a DID-signed price list; a Customer caches other Runners' lists. Same
tables, different writers — which is what makes ordering possible offline, from cache.

```sql
-- One row per published version of a Runner's list.
-- ✍️ Runner writes its own; Customer writes cached copies (read-only to the UI).
CREATE TABLE price_lists (
  id               TEXT PRIMARY KEY,         -- '<runner_did>:<published_at>'
  runner_did       TEXT NOT NULL,
  published_at     INTEGER NOT NULL,
  delivery_fee_zar TEXT,                     -- the Runner's delivery fee
  signature        BLOB NOT NULL,            -- DID signature over the canonical body
  fetched_at       INTEGER,                  -- NULL until this device has a copy
  is_current       INTEGER NOT NULL DEFAULT 1
);

-- ✍️ Same rule as its parent.
CREATE TABLE runner_prices (
  id            TEXT PRIMARY KEY,            -- '<price_list_id>:<item_id>'
  price_list_id TEXT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES catalog_items(id),
  price_zar     TEXT NOT NULL,
  available     INTEGER NOT NULL DEFAULT 1,  -- toggle, not a stock count
  UNIQUE (price_list_id, item_id)
);
```

The signature is what stops a relay or an impostor substituting its own price list. An
order never reads live prices — it freezes them (§3, `order_items`).

---

## 2.5. Swap / Converter Tables (ADR-0014)

The converter feature is integrated into both Customer and Runner apps.
It does not hold funds — it facilitates atomic swaps and P2P exchange discovery.

```sql
-- Swap orders (UnstoppableSwap BTC↔XMR atomic swaps)
-- ✍️ Both apps write their own swaps.
CREATE TABLE swaps (
  id                TEXT PRIMARY KEY,        -- UUIDv4
  persona           TEXT NOT NULL,           -- 'customer' | 'runner'
  direction         TEXT NOT NULL,           -- 'btc_to_xmr' | 'xmr_to_btc' | 'zar_to_xmr' | 'xmr_to_zar'
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','deposit_waiting','executing','completed','refunded','failed','expired')),
  -- BTC side
  btc_amount_sat    INTEGER,                 -- satoshis
  btc_address       TEXT,                    -- BTC HTLC address
  btc_txid          TEXT,                    -- deposit txid
  btc_refund_txid   TEXT,                    -- refund txid if expired
  -- XMR side
  xmr_amount_pico   INTEGER,                 -- piconero
  xmr_subaddress    TEXT,                    -- XMR subaddress for deposit/claim
  xmr_txid          TEXT,                    -- claim txid
  -- ZAR side (P2P via XmrBazaar/Haveno)
  zar_amount_cents  INTEGER,                 -- cents
  zar_reference     TEXT,                    -- P2P trade reference
  -- Timing
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER,                 -- HTLC timelock expiry
  completed_at      INTEGER,
  -- Fees
  network_fee_btc   INTEGER,
  network_fee_xmr   INTEGER,
  service_fee_zar   INTEGER,
);
```

```sql
-- P2P Exchange Offers (cached from XmrBazaar/Haveno)
-- ✍️ Both apps cache; read-only to UI.
CREATE TABLE exchange_offers (
  id              TEXT PRIMARY KEY,          -- source-specific ID
  source          TEXT NOT NULL,             -- 'xmrbazaar' | 'haveno'
  direction       TEXT NOT NULL,             -- 'zar_to_xmr' | 'xmr_to_zar'
  price_zar_per_xmr TEXT NOT NULL,           -- rate
  min_amount      TEXT NOT NULL,             -- minimum trade
  max_amount      TEXT NOT NULL,             -- maximum trade
  payment_method  TEXT,                      -- 'bank_transfer' | 'instant_eft' | etc.
  trader_rating   REAL,                      -- 0-5 if available
  fetched_at      INTEGER NOT NULL,
  expires_at      INTEGER,                   -- offer expiry
  UNIQUE (source, id)
);
```

```sql
-- Swap Events (audit trail for debugging)
-- ✍️ Both apps write their own events.
CREATE TABLE swap_events (
  id           TEXT PRIMARY KEY,
  swap_id      TEXT NOT NULL REFERENCES swaps(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL
    CHECK (kind IN ('created','deposit_seen','htlc_locked','executing','completed','refunded','failed','expired')),
  observed_at  INTEGER NOT NULL,
  detail       TEXT                           -- provider payload, for forensics
);
```

---

## 3. Orders

One wide table. The Customer owns the money columns, the Runner owns the delivery columns,
and the state machine in §5 says who may move `status` along which edge.

```sql
-- ✍️ Both apps, per column. One row per order per device.
CREATE TABLE orders (
  id                TEXT PRIMARY KEY,        -- UUIDv4, minted by the Customer

  customer_did      TEXT NOT NULL,
  runner_did        TEXT NOT NULL,

  -- ── state ────────────────────────────────────────────────────────────
  status            TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','accepted','in_transit',
                      'delivered','confirmed','cancelled','expired')),
  dispute_state     TEXT NOT NULL DEFAULT 'none'
    CHECK (dispute_state IN ('none','open','resolved','dismissed')),

  -- ── money  (✍️ Customer; 👁️ read-only on the Runner device) ─────────
  total_zar         TEXT NOT NULL,           -- frozen from the price snapshot
  delivery_fee_zar  TEXT,
  monero_subaddress TEXT,                    -- [v1: mock provider]
  payment_txid      TEXT,                    -- [v1: mock provider]
  paid_at           INTEGER,
  expires_at        INTEGER,                 -- payment window (default +15 min)
  cancelled_by      TEXT CHECK (cancelled_by IN ('customer','runner')),
  cancel_reason     TEXT,                    -- e.g. 'cannot_fulfil'

  -- ── delivery  (✍️ Runner; 👁️ read-only on the Customer device) ──────
  delivery_geohash  TEXT,                    -- coarse; the exact address is in chat
  proof_cid         TEXT,                    -- pointer to the proof bundle
  proof_key         TEXT,                    -- random per order; unlocks that bundle
  delivered_at      INTEGER,
  confirmed_at      INTEGER,

  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  purge_after       INTEGER                  -- ignored while dispute_state = 'open'
);
```

**There is no delivery-address column.** The exact address exists in exactly one place:
the body of an order-chat message (Q6, Q20). The Runner's `delivery_geohash` is coarse
enough to navigate a neighbourhood and useless as a record of where someone lives.

```sql
-- ✍️ Customer writes at placement; 👁️ Runner adopts verbatim.
-- The unit price is a snapshot: a later price change never moves an existing order.
CREATE TABLE order_items (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id        TEXT NOT NULL REFERENCES catalog_items(id),
  display_name   TEXT NOT NULL,              -- label snapshot at order time
  quantity       INTEGER NOT NULL,
  unit_price_zar TEXT NOT NULL,              -- price snapshot at order time
  line_total_zar TEXT NOT NULL
);
```

```sql
-- ✍️ The device that observes the transition (Customer in v1).
-- The audit trail that makes swapping MockPaymentProvider for a real gateway debuggable.
CREATE TABLE payment_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,                 -- 'mock' | 'moneropay' | 'acceptxmr'
  kind        TEXT NOT NULL
    CHECK (kind IN ('requested','seen','confirmed','expired')),
  observed_at INTEGER NOT NULL,
  detail      TEXT                           -- provider payload, for forensics
);
```

---

## 4. Messages, proofs, wallet, mirrors

```sql
-- ✍️ Both apps write their own order thread.
-- body is readable text; SQLCipher is what protects it at rest (see §7).
CREATE TABLE messages (
  id             TEXT PRIMARY KEY,           -- UUIDv4
  order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  direction      TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_did     TEXT NOT NULL,
  recipient_did  TEXT NOT NULL,
  body           TEXT,                       -- decrypted text (SQLCipher-protected)
  envelope       BLOB,                       -- outbox only; NULL once sent
  delivery_state TEXT NOT NULL DEFAULT 'queued'
    CHECK (delivery_state IN ('queued','sent','delivered','failed')),
  attempts       INTEGER NOT NULL DEFAULT 0, -- retry counter while offline
  sent_at        INTEGER,
  received_at    INTEGER,
  read_at        INTEGER,
  purge_after    INTEGER
);
```

The envelope is the retry payload while a message is queued. Once it is sent, the ciphertext
is cleared: it can never be read again anyway, and there is no reason to keep it around.

```sql
-- ✍️ Runner writes capture metadata; Customer writes the verdict. No local photo: only the CID.
CREATE TABLE proof_bundles (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  -- Runner-written
  cid                 TEXT NOT NULL,         -- IPFS/Meshkit content id
  captured_at         INTEGER,
  capture_geohash     TEXT,                  -- coarse; exact coords are never persisted
  signature_valid     INTEGER,               -- hardware attestation checked locally
  uploaded_at         INTEGER NOT NULL,

  -- Customer-written
  verified_at         INTEGER,
  verification_result TEXT CHECK (verification_result IN ('accepted','rejected')),
  verification_note   TEXT,

  purge_after         INTEGER
);
```

A rejected proof is re-uploaded as a new row; the order row is never rewritten. Exact
coordinates exist in memory only, while the ZK location proof is generated.

```sql
-- ✍️ Runner device only. The payee holds the wallet; the seed is in secure storage.
-- Wallet UX: 24-word seed, biometric-only unlock (no PIN fallback), duress PIN, auto subaddress labels, fee preview.
-- Recovery: seed phrase restore only. Biometric failure → recovery phrase entry.
CREATE TABLE wallet_metadata (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  primary_address  TEXT,
  account_index    INTEGER NOT NULL DEFAULT 0,
  restore_height   INTEGER,
  last_sync_height INTEGER,
  last_sync_at     INTEGER
);
```

### Mirrors — read-only on the device

These four tables exist on devices only as caches of admin-service state. The app never
writes them, and a `sync_state` row records how stale each one is.

```sql
-- 👁️ Customer device only. Runners never see strikes (ADR-0005).
CREATE TABLE strikes (
  id              TEXT PRIMARY KEY,          -- server-issued id
  subject_did     TEXT NOT NULL,             -- a Customer DID
  reason          TEXT NOT NULL,             -- 'no_show' | 'false_claim' | 'abusive'
  issued_at       INTEGER NOT NULL,
  acknowledged_at INTEGER                  -- local-only write
);

-- 👁️ Both apps. This is also how a Customer discovers Runners at all.
CREATE TABLE runner_directory (
  id                   TEXT PRIMARY KEY,     -- runner DID
  runner_did           TEXT NOT NULL,
  display_name         TEXT,
  onion_address        TEXT NOT NULL,
  approved_at          INTEGER,
  banned_at            INTEGER,
  ban_reason           TEXT,
  current_price_list_id TEXT,                -- what to refresh the cache from
  last_active_at       INTEGER
);

-- 👁️ Both apps.
CREATE TABLE platform_settings (
  id         TEXT PRIMARY KEY,               -- setting key
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 👁️ Customer device: draft locally, upload when Tor returns. 👁️ Runner device: read-only.
CREATE TABLE disputes (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL,
  customer_did     TEXT NOT NULL,
  runner_did       TEXT NOT NULL,
  reason           TEXT NOT NULL,            -- 'non_delivery' | 'wrong_item' | 'other'
  proof_cid        TEXT,
  proof_key_shared INTEGER NOT NULL DEFAULT 0,  -- did the Customer hand over the key?
  status           TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','open','resolved','dismissed')),
  created_at       INTEGER NOT NULL,
  resolved_at      INTEGER,
  admin_response   TEXT
);

-- One row per sync source. ✍️ Local bookkeeping only.
CREATE TABLE sync_state (
  id              TEXT PRIMARY KEY,          -- 'strikes'|'settings'|'directory'|'disputes'
  source          TEXT NOT NULL,
  last_success_at INTEGER,
  cursor          TEXT,                      -- opaque server cursor / etag
  last_error      TEXT
);
```

**Install sets.** The Customer app installs every table above. The Runner app installs the
same schema **minus `strikes`** — a Runner has no business holding a list of Customers and
what they were penalised for, and the sync source simply never populates it.

---

## 5. Order state machine — who writes which edge

`status` is a single field with state-dependent writers. This table is the contract; the
query layer enforces it.

| Edge | Actor |
|---|---|
| `pending_payment → paid` | Customer (payment observed; rows in `payment_events`) |
| `pending_payment → expired` | whichever device observes the window lapse |
| `pending_payment → cancelled` | Customer |
| `paid → cancelled` (before acceptance) | Customer, or Runner with `cancel_reason='cannot_fulfil'` |
| `paid → accepted` | **Runner** |
| `accepted → in_transit` | **Runner** |
| `in_transit → delivered` | **Runner** (writes `proof_cid`, `proof_key`, a `proof_bundles` row) |
| `delivered → confirmed` | **Customer** (writes the verdict on the proof row) |
| accepted → any dispute | Customer raises; Admin adjudicates; `dispute_state` changes, **not** `status` |
| — | After `accepted`, a Customer can no longer cancel. That is the strike model's job. |

`dispute_state` is deliberately not a status value: a dispute freezes purge and is
adjudicated alongside the delivery state machine, it does not replace it.

---

## 6. Retention & purge

| Data | Retention | Purge trigger |
|---|---|---|
| Messages | 30 days after completion | `purge_after` on the row, cascade with the order |
| Orders + `order_items` | 90 days after completion | `purge_after`; **frozen while `dispute_state='open'`** |
| Proof bundles (local row) | with the order | cascade |
| Proof bundle blob (Meshkit/IPFS) | 90 days | unpin request |
| Non-current price lists | 30 days after being superseded | background sweep |
| Contacts | indefinite | user-initiated |
| Mirrors (`strikes`, `directory`, `settings`) | replaced on each successful sync | — |
| Wallet metadata | indefinite | user-initiated wipe |
| Admin: disputes | 1 year after resolution; `proof_key` cleared on close | admin-initiated |
| Admin: strikes | indefinite while active | admin-initiated |

**Purge implementation** — this is the fix for the v1 bug that would have wiped the database:

```typescript
async function purgeExpiredData() {
  const now = Date.now();
  await database.write(async () => {
    const expired = await database.get('orders')
      .query(Q.where('purge_after', Q.lt(now)),
             Q.where('dispute_state', Q.notEq('open')))
      .fetch();
    for (const order of expired) {
      await order.destroyPermanently();   // real DELETE — NOT unsafeResetDatabase()
    }
  });
  // WatermelonDB leaves no tombstones after destroyPermanently; reclaim the pages.
  await database.adapter.unsafeSqlQuery('VACUUM;');
}
```

`markAsDeleted` is the wrong tool here: it sets `_status='deleted'` and waits for a sync
that does not exist, so the row — and the plaintext — would sit on disk forever.

---

## 7. Encryption & key management

| Secret | Where it lives | Protection |
|---|---|---|
| SQLCipher DB key (each app) | `expo-secure-store` | Keychain / Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, biometric-gated |
| DID private key (Ed25519) | `expo-secure-store` | as above |
| Signal identity key | `expo-secure-store` | as above |
| Wallet seed (Runner) | `expo-secure-store` | as above; **never** in the database; 24-word seed, biometric-only unlock, duress PIN |
| Proof key | `orders.proof_key` | inside the SQLCipher file; also sent over the order chat |
| Admin service DB | SQLCipher, WAL | key from the service environment, not in the repository |

```typescript
// First launch of either app
const dbKey = await Crypto.getRandomBytesAsync(32);
await SecureStore.setItemAsync('damz_db_key', Buffer.from(dbKey).toString('hex'), {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
});
```

Two notes the v1 document got wrong or left open:

- **Proof bundles**: encrypted with a fresh random AES-256-GCM key per bundle, generated by
  the Runner and sent to the Customer over the encrypted chat (ADR-0003). There is no
  master key and no HKDF-from-order-ID; the order ID is an identifier, not a secret.
- **"Zero plaintext at rest"** still holds after Q15: a decrypted message body lives *inside*
  the SQLCipher file, which is encrypted on disk. It is not stored beside it.

---

## 8. The admin service

Tor-hidden **Rust + Axum** process, one SQLCipher file in WAL mode (Q18, ADR-0007). The five
tables shown below form a separate Admin-service schema; they are not among the 19
client-side WatermelonDB tables in §§2–4. Similarly named mirror tables on devices are
distinct records. The service uses the separate API contract described in ADR-0007.

```sql
CREATE TABLE admin_identity (      -- exactly one admin; you
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  did           TEXT NOT NULL,
  password_hash TEXT NOT NULL,     -- Argon2id
  created_at    INTEGER NOT NULL
);

CREATE TABLE runner_registry (
  id             TEXT PRIMARY KEY,           -- runner DID
  runner_did     TEXT NOT NULL,
  display_name   TEXT,
  onion_address  TEXT NOT NULL,
  approved_at    INTEGER,
  banned_at      INTEGER,
  ban_reason     TEXT,
  last_active_at INTEGER
  -- no order counts: see ADR-0001
);

CREATE TABLE disputes (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,               -- opaque to the admin
  customer_did  TEXT NOT NULL,
  runner_did    TEXT NOT NULL,
  reason        TEXT NOT NULL,
  proof_cid     TEXT,                        -- only what the Customer shares
  proof_key     TEXT,                        -- cleared when the dispute closes
  status        TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','dismissed')),
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER,
  admin_notes   TEXT
);

CREATE TABLE strikes (
  id         TEXT PRIMARY KEY,
  subject_did TEXT NOT NULL,                 -- a Customer DID
  reason     TEXT NOT NULL,                  -- 'no_show' | 'false_claim' | 'abusive'
  issued_at  INTEGER NOT NULL,
  revoked_at INTEGER,
  notes      TEXT
);

CREATE TABLE platform_settings (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

The service holds **no** order rows, **no** messages, and **no** proof blobs. A dispute it
can review is a dispute a Customer chose to hand over, one key at a time.

---

## 9. Deliberately not modelled in v1

Recorded so nobody assumes these exist:

- **Runner → admin reports.** Q7 scoped the service to registry, bans, disputes, strikes,
  settings. A Runner who has a problem with a Customer contacts the Admin out of band, and
  the Admin issues a strike. If this becomes a real workflow, it is a new server table.
- **Ratings / reputation.** `contacts.total_orders` style counters were dropped: with no
  server, they are self-reported and meaningless.
- **Inventory counts.** Availability is a toggle (`runner_prices.available`), not a stock
  level.
- **Customer-side bans propagating to Runners.** Q21 keeps strikes off Runner devices.
  Practical consequence: a banned Customer can rotate to a new DID, exactly as a Runner can.
  Bans are a deterrent against casual abuse, not an identity system.
- **Multi-runner or multi-item-per-runner inventory, cart abandonment, refunds.** Out of
  scope for the eight-item basket; a refund is a dispute outcome today.
- **Exact delivery coordinates** — memory only, never a column (§4).

---

## 10. Data flow, end to end

1. **Publish.** Runner sets prices and availability → signs → `price_lists` + `runner_prices`.
2. **Discover.** Customer syncs `runner_directory`, fetches and caches a Runner's list.
3. **Order.** Customer writes `orders` (`pending_payment`) + `order_items` snapshots, sends
   the order and the address over the chat.
4. **Pay.** Mock provider returns a subaddress and amount; every transition lands in
   `payment_events`; `status` → `paid`.
5. **Accept.** Runner adopts the order row, `status` → `accepted`.
6. **Deliver.** Runner captures photo + ZK proof, uploads the encrypted bundle, writes
   `proof_bundles` + `orders.proof_cid`, generates `proof_key`, sends it over the chat.
7. **Confirm.** Customer fetches the bundle, decrypts with `proof_key`, verifies, writes the
   verdict, `status` → `confirmed`.
8. **Purge.** 30 days later the messages go; 90 days later the order goes — unless a dispute
   is open, in which case the row is frozen until it resolves.

---

## 11. New ADRs from Grilling Session (2026-10-04)

The following ADRs were created during the grilling session to document decisions not in the original refinement:

| ADR | Title | Summary |
|-----|-------|---------|
| 0006 | Signal Protocol: `react-native-libsignal-client` | Official libsignal Rust core via native bindings; custom TS store |
| 0007 | Admin service: Rust + Axum | Memory safety, single binary, `arti` for Tor |
| 0008 | Custom minimal relay in Rust | ~200 lines, Axum + Tokio + Arti, in-memory only |
| 0009 | Monero gateway: AcceptXMR Rust library | Custom gateway, unified Rust stack |
| 0010 | Dual storage: Meshkit S3 + Helia opt-in | Feature flag, both backends in v1 |
| 0011 | Parallel roadmap | 4 tracks (A/B/C/D) + integration |
| 0012 | Distribution: F-Droid + GrapheneOS/CalyxOS | No Play Store, reproducible builds |
| 0013 | Security validation: Internal red-team + narvy SAST | 2-week pre-launch exercise |
| 0014 | Converter: Full UnstoppableSwap in v1 | COMIT protocol BTC↔XMR atomic swaps |
| 0015 | Runner onboarding: Invite-only pre-creation | Admin CLI pre-creates, runner claims |
| 0016 | Admin API: REST + SSE | DID-signed requests, sync endpoints + push |
| 0017 | Monorepo: Turborepo + Expo + Cargo | Cross-language task graph |
| 0018 | DID: `@did-tools/key` | Lightweight `did:key` implementation |
| 0019 | ZK proof: Port Zakura optimizations | 14x faster mobile proofs |
| 0020 | Photo attestation: `@realreel/photo-attest` | C2PA + Secure Enclave/StrongBox + device attestation |
| 0021 | Signal store: TypeScript over expo-sqlite | Pure TS, auditable, no native deps |
| 0022 | Tor lifecycle: Foreground service + persistent notification | Always-on, battery saver toggle |
| 0023 | Mock payment: Configurable scenarios | success/timeout/partial/double |
| 0024 | Engineering philosophy | Silicon-grade, hacker paranoia, delightful UI |
| 0025 | UI stack: Reusables + NativeWind + Reanimated 3 | shadcn/ui for RN, Tailwind, 60fps |
| 0026 | Wallet UX | 24-word seed, biometric-only, duress PIN, auto labels, fee preview |
| 0027 | Security flows | Seed restore, recovery phrase, Tor retry, auto re-key, geohash fallback |
| 0028 | Admin API endpoints | 7 endpoints, DISPUTES, SSE, DID-signed |
| 0029 | Relay protocol spec | SHA256, TTL, seq nums, backoff, 3 relays, 64KB |
| 0030 | Dispute resolution | Refund=new payment, runner strikes 3=ban, 14-day timeout |
| 0031 | Push notifications | UnifiedPush, self-hosted, encrypted payload |
| 0032 | Error handling | Centralized error codes → messages |
| 0033 | App lifecycle & permissions | Graceful fallbacks, biometric-only |
| 0034 | Build/CI/CD | Reproducible, Hermes, EAS, GitHub Actions |
| 0035 | Docs/Legal | AGPL-3.0, single privacy policy, F-Droid metadata |

---

## 12. App Screen Flows (from Grilling)

### Customer App (13 Screens + Converter Tab)
1. **Onboarding** — Generate DID, backup 24-word seed, pseudonym, permissions
2. **Home/Discover** — Nearby runners (runner_directory), filter by radius, availability + fee
3. **Runner Profile** — Cached price list, items, delivery radius
4. **Item Selection** — 7 catalog items, runner prices, quantity, running total
5. **Address Entry** — Geocoded to geohash, saved addresses, map picker
6. **Order Review** — Items, prices, delivery fee, total ZAR, est. XMR, 15-min expiry
7. **Payment** — Monero subaddress + QR, countdown, status polling
8. **Order Tracking** — Status timeline, runner coarse geohash, chat button
9. **Order Chat** — Signal Protocol E2EE, text, photos, proof key
10. **Delivery Verification** — Proof bundle (photo + ZK), accept/reject, dispute
11. **Order History** — 90 days, filter, reorder
12. **Disputes** — List, create, view admin response, share proof key
13. **Settings** — Theme, radius, notifications, Tor status, backup DID, biometric, about
**Converter Tab**: ZAR→XMR (XmrBazaar/Haveno/UnstoppableSwap)

### Runner App (13 Screens + Converter Tab)
1. **Onboarding** — DID + onion, claim pre-created registry (ADR-0015)
2. **Dashboard** — Active orders, earnings, availability toggle
3. **Price List Editor** — 8 items, prices, availability, delivery fee, sign & publish
4. **Order Requests** — Incoming with countdown
5. **Order Detail** — Items, address, chat
6. **Accept/Reject** — Cannot cancel after accept
7. **Active Order** — Navigation (coarse geohash), in_transit
8. **Delivery Capture** — Camera + ZK proof + photo attest (@realreel/photo-attest)
9. **Proof Review** — Preview before upload
10. **Upload & Send Key** — IPFS upload, CID + proof_key over chat
11. **Order History** — Completed, disputed
12. **Wallet** — Balance, subaddresses (auto "Order #DMZ-XXX"), withdraw (XMR→ZAR via Haveno), backup (seed phrase, biometric-gated), duress PIN, fee preview
13. **Settings** — Availability, radius, Tor, backup, about
**Converter Tab**: XMR→ZAR (Haveno)

### Converter Feature (Integrated Tab)
- **Customer**: ZAR→XMR via XmrBazaar/Haveno deep links + UnstoppableSwap BTC→XMR
- **Runner**: XMR→ZAR via Haveno
- **Shared**: `SwapManager` in `@damz/core`

---

## 13. Security Implementation Details

### Wallet (Runner) — ADR-0026
- **Seed**: 24 words (256-bit entropy)
- **Unlock**: Biometric-only (FaceID/TouchID/Fingerprint), no PIN fallback
- **Duress**: Fake PIN → nearly-empty wallet
- **Subaddress labels**: Auto "Order #DMZ-XXX"
- **Fee preview**: Shown before send
- **Recovery**: Seed phrase only (biometric failure → recovery phrase entry)

### Migration & Fallbacks — ADR-0027
- **Identity migration**: Seed phrase restore on new device
- **Biometric failure**: Recovery phrase entry (no PIN)
- **Tor issues**: Exponential backoff retry + "Tor connecting..." + offline indicator (cached data)
- **Signal session corruption**: Automatic re-keying (Signal Protocol handles)
- **ZK proof failure**: Coarse geohash fallback (no ZK), retry with lower precision

### Push Notifications — ADR-0031
- **UnifiedPush** distributor (self-hosted on admin VPS)
- Works over Tor, no Google/Apple
- Encrypted payload via Signal session
- Apps register via Tor on first launch

### Error Handling — ADR-0032
- Centralized error system: ErrorBoundary + error codes → user messages
- Codes: TOR_CONNECTION_FAILED, PAYMENT_EXPIRED, ZK_PROOF_FAILED, etc.
- Per-screen can override

### Dispute Resolution — ADR-0030
- Refund = runner sends new Monero payment (no chargebacks)
- Runner strikes: 3 = ban (admin issues via CLI)
- Timeout: 14 days auto-dismiss
- Asymmetric: Customer raises, admin judges with customer's evidence only

---

## 14. Build & CI/CD — ADR-0034

**Monorepo**: Turborepo + Bun workspaces + Cargo workspaces
- `apps/*` (Expo), `packages/*` (TS), `services/*` (Rust)

**Pipeline** (GitHub Actions):
1. Lint + Typecheck (`turbo run lint typecheck`)
2. Unit Tests (`turbo run test`)
3. Integration Tests (`turbo run test:integration`)
4. Security Scan (`narvy-cli` on APK/IPA)
5. Build Android APK + iOS IPA (EAS)
6. E2E Tests (Maestro on emulator/simulator)
7. Contract Tests (Admin API OpenAPI + Relay blob schema)
8. Coverage Gate (fail if <70% on core)
9. Deploy: APK to GitHub Releases, metadata to F-Droid

**Requirements**:
- Reproducible builds for F-Droid (mandatory)
- Hermes bytecode compilation
- AGPL-3.0 license

---

## 15. Legal & Documentation — ADR-0035

**Documents**:
- ARCHITECTURE.md, API.md, DEPLOYMENT.md, USER_GUIDE_CUSTOMER.md, USER_GUIDE_RUNNER.md
- SECURITY.md (threat model, audit results, responsible disclosure)
- PRIVACY_POLICY.md (single policy: discloses Tor, Monero, XmrBazaar/Haveno, no personal data)
- TERMS_OF_SERVICE.md (dispute resolution, no warranty)
- F-Droid metadata (YAML: categories, license, source URL)
- CHANGELOG.md

**Privacy Policy**: Covers all features including converter (discloses XmrBazaar/Haveno interaction)