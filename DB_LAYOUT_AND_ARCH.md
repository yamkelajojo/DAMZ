# DAMZ — Database Layout & Architecture (v2)

**Status**: rewritten 2026-10-04 by the `grill-with-docs` refinement session.
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

- **Customer app** (`apps/customer`) — places orders, pays, confirms delivery.
- **Runner app** (`apps/runner`) — publishes a price list, accepts and fulfils orders.
- **Admin service** (`services/admin`, Tor-hidden) — the only server. Registry, bans,
  strikes, disputes, settings. It never holds order, chat, or proof content (ADR-0001).

`packages/db` defines **every table once**. Each app installs the set it needs, and each
device writes only the columns it owns. The rest are NULL. Every table below is annotated
with who writes it:

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
-- The fixed seven-item catalog. Seeded at install, never written by anyone.
-- ✍️ Owner: the app bundle. 👁️ Both apps.
CREATE TABLE catalog_items (
  id           TEXT PRIMARY KEY,             -- 'cabbage', 'spinach', 'cinnamon', ...
  display_name TEXT NOT NULL,                -- 'Cabbage', ...
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
the body of an order-chat message (Q6, Q20). The Runner’s `delivery_geohash` is coarse
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
| Wallet seed (Runner) | `expo-secure-store` | as above; **never** in the database |
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

Tor-hidden Fastify process, one SQLCipher file in WAL mode (Q18). Tables:

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
  scope for the seven-item basket; a refund is a dispute outcome today.
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
