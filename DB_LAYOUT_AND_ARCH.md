# DAMZ — Database Layout & Architecture

Based on your answers, here's the database design. I've organized it around three separate database environments: the **Customer App**, the **Runner App**, and the **Admin Dashboard**. Each has its own schema tuned to its specific role, with minimal overlap.

---

## Design Principles (from your answers)

1. **Local-first, no central server.** Each app owns its local database. There is no shared cloud database.
2. **SQLCipher encryption everywhere.** Every local database file is encrypted with a key stored in the OS keychain/keystore.
3. **Admin sees proof for disputes, but not day-to-day data.** The admin dashboard has a separate, limited view.
4. **Runner sets prices and radius; customer sets radius.** These are local preferences, not global settings.
5. **Order chat dies with the order.** Messages are deleted when the order is purged.
6. **Monero is "prepared for" but not active.** Schema fields exist; functionality is stubbed.

---

## Part I: Customer App Database

### Core Identity Table

Stores the customer's DID and pseudonym. No email, no phone.

```sql
CREATE TABLE customer_identity (
  id TEXT PRIMARY KEY,              -- DID string (did:key:... or did:ethr:...)
  display_name TEXT,               -- User-chosen pseudonym
  search_radius_km REAL DEFAULT 5, -- Default search radius
  created_at INTEGER NOT NULL,
  last_active_at INTEGER
);
```

### Orders Table

The central transactional record. Status transitions are enforced at the application layer.

```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY,              -- Order UUID (generated on device)
  runner_did TEXT NOT NULL,        -- The runner's DID
  items TEXT NOT NULL,             -- JSON: [{"name": "Cabbage", "quantity": 2}]
  total_zar TEXT NOT NULL,         -- Total in ZAR (string to avoid float)
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK(status IN (
      'pending_payment',   -- Waiting for Monero confirmation
      'paid',              -- Payment confirmed, runner notified
      'accepted',          -- Runner accepted the order
      'in_transit',        -- Runner en route
      'delivered',         -- Runner uploaded proof
      'confirmed',         -- Customer verified proof
      'expired',           -- Payment window elapsed
      'cancelled'          -- Customer cancelled before payment
    )),
  monero_subaddress TEXT,           -- [PREPARED] Generated subaddress
  payment_txid TEXT,                -- [PREPARED] Monero transaction ID
  proof_cid TEXT,                   -- IPFS CID of encrypted proof bundle
  delivery_address_type TEXT        -- 'text', 'geohash', 'pin'
    CHECK(delivery_address_type IN ('text', 'geohash', 'pin')),
  delivery_address_value TEXT,     -- The actual address (free text, geohash, or coords)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,              -- Payment window expiry (default: +15 min)
  purge_after INTEGER              -- Auto-purge date (default: +90 days)
);
```

**Indexes:**
```sql
CREATE INDEX idx_orders_runner ON orders(runner_did);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_purge ON orders(purge_after);
```

### Messages Table

Stores Signal Protocol envelopes. The `envelope` column is opaque ciphertext — SQLCipher encrypts it again at rest.

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  sender_did TEXT NOT NULL,
  recipient_did TEXT NOT NULL,
  envelope BLOB NOT NULL,           -- Signal Protocol ciphertext
  sent_at INTEGER NOT NULL,
  received_at INTEGER,
  read_at INTEGER,
  purge_after INTEGER               -- Same as order purge_after
);
```

**Index:**
```sql
CREATE INDEX idx_messages_order ON messages(order_id);
```

### Runner Contacts Table

Local cache of runners the customer has interacted with. This is **not** a global registry — it's per-customer.

```sql
CREATE TABLE runner_contacts (
  id TEXT PRIMARY KEY,              -- Signal Protocol ProtocolAddress
  did TEXT NOT NULL UNIQUE,        -- Runner's DID
  display_name TEXT,               -- Pseudonym shown to customer
  onion_address TEXT,              -- Runner's Tor .onion service
  signal_identity_key BLOB,        -- Runner's Signal identity key
  last_order_at INTEGER,           -- Most recent order with this runner
  total_orders INTEGER DEFAULT 0,  -- Local counter (no global reputation)
  is_blocked INTEGER DEFAULT 0    -- Customer can locally block a runner
);
```

### Customer Strikes Table

You mentioned customers get strikes for bad behaviour (3 strikes = ban). This is tracked **locally on the customer's device** — there is no central strike database. The admin can issue a strike via the dashboard if a runner complains, but the customer's device only knows about strikes it has received.

```sql
CREATE TABLE customer_strikes (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,            -- 'no_show', 'false_claim', 'abusive'
  issued_at INTEGER NOT NULL,
  issued_by_admin INTEGER DEFAULT 0, -- 1 if admin-issued
  acknowledged INTEGER DEFAULT 0
);
```

### Wallet Metadata Table

**The Monero seed is NOT stored here.** Only metadata for wallet synchronization.

```sql
CREATE TABLE wallet_metadata (
  id INTEGER PRIMARY KEY CHECK(id = 1),  -- Singleton row
  primary_address TEXT,             -- [PREPARED] Monero primary address
  account_index INTEGER DEFAULT 0,
  restore_height INTEGER,
  last_sync_height INTEGER,
  xmr_balance_cache TEXT,           -- Cached balance (string, piconero)
  last_sync_at INTEGER
);
```

---

## Part II: Runner App Database

### Runner Identity Table

Stores the runner's DID, their onion address, and their operational preferences.

```sql
CREATE TABLE runner_identity (
  id TEXT PRIMARY KEY,              -- DID string
  display_name TEXT,               -- Pseudonym (chosen by runner, visible to customers)
  onion_address TEXT UNIQUE,       -- The runner's Tor .onion service
  search_radius_km REAL DEFAULT 10, -- Runner's delivery radius
  is_available INTEGER DEFAULT 1,  -- Toggle: accepting orders or not
  created_at INTEGER NOT NULL,
  approved_by_admin INTEGER DEFAULT 0, -- 1 if admin approved this runner
  banned INTEGER DEFAULT 0         -- [ADMIN-SET] If 1, runner cannot receive orders
);
```

### Catalog Table (Runner's Own Stock)

The runner marks items as available or unavailable. **No inventory counts** — just availability toggles.

```sql
CREATE TABLE catalog (
  item_id TEXT PRIMARY KEY,        -- Fixed key: 'cabbage', 'spinach', etc.
  display_name TEXT NOT NULL,      -- Human-readable name
  is_available INTEGER DEFAULT 1,  -- Runner toggles this
  price_zar TEXT NOT NULL,         -- Runner sets their own price
  min_delivery_fee_zar TEXT,       -- Runner's minimum delivery fee
  updated_at INTEGER NOT NULL
);
```

**Seeded data (fixed at install):**
```sql
INSERT INTO catalog (item_id, display_name, price_zar, min_delivery_fee_zar) VALUES
  ('cabbage',              'Cabbage',              '15.00', '20.00'),
  ('spinach',              'Spinach',              '12.00', '20.00'),
  ('cinnamon',             'Cinnamon',             '25.00', '20.00'),
  ('cauliflower',          'Cauliflower',          '18.00', '20.00'),
  ('rock_salt',            'Rock Salt',            '8.00',  '20.00'),
  ('flour',                'Flour',                '22.00', '20.00'),
  ('bicarbonate_of_soda',  'Bicarbonate Of Soda',  '10.00', '20.00');
```

### Orders Table (Runner's View)

Same structure as the customer's, but with **different ownership**. The runner owns `status` transitions; the customer owns `confirmed`. The `proof_cid` is written by the runner after uploading.

```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY,              -- Same order UUID as customer's
  customer_did TEXT NOT NULL,
  items TEXT NOT NULL,             -- JSON
  total_zar TEXT NOT NULL,
  delivery_fee_zar TEXT,           -- Final delivery fee (min + adjustment)
  status TEXT NOT NULL DEFAULT 'paid'
    CHECK(status IN (
      'paid',              -- Payment confirmed
      'accepted',          -- Runner accepted
      'in_transit',        -- Runner en route
      'delivered',         -- Proof uploaded
      'confirmed',         -- Customer confirmed
      'expired',           -- Payment window elapsed
      'cancelled'          -- Customer cancelled before payment
    )),
  proof_cid TEXT,                  -- IPFS CID (written by runner)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  purge_after INTEGER
);
```

### Runner Messages Table

Same structure as customer's, scoped to this runner's orders.

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  sender_did TEXT NOT NULL,
  recipient_did TEXT NOT NULL,
  envelope BLOB NOT NULL,
  sent_at INTEGER NOT NULL,
  received_at INTEGER,
  read_at INTEGER,
  purge_after INTEGER
);
```

### Proof Bundles Table (Runner's Local Cache)

Stores metadata about proof bundles uploaded to IPFS. **The actual bundle is not stored here** — only the CID and local metadata.

```sql
CREATE TABLE proof_bundles (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  cid TEXT NOT NULL,               -- IPFS CID
  photo_captured_at INTEGER,       -- When the photo was taken
  location_lat REAL,               -- [LOCAL ONLY] Encrypted by SQLCipher
  location_lng REAL,               -- [LOCAL ONLY] Encrypted by SQLCipher
  zk_proof_metadata TEXT,          -- JSON: proof validity, confidence
  signature_valid INTEGER,         -- 1 if hardware signature verified locally
  uploaded_at INTEGER NOT NULL,
  purge_after INTEGER
);
```

**Critical**: The `location_lat` and `location_lng` columns are **local only**. They are used to verify the ZK proof locally before upload. The encrypted bundle uploaded to IPFS contains only the ZK proof (which does not reveal coordinates). The local database never leaves the device.

---

## Part III: Admin Dashboard Database

The admin dashboard is a **separate web application** (React + Node/Fastify) running behind Tor as a `.onion` service. Its database is a **server-side SQLite or PostgreSQL** instance with limited data.

### Admin Identity Table

The admin logs in with a DID and a password (hashed). No email.

```sql
CREATE TABLE admin_identity (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  did TEXT NOT NULL,
  password_hash TEXT NOT NULL,     -- Argon2id or bcrypt
  created_at INTEGER NOT NULL
);
```

### Runner Registry Table

This is the **only place** where the admin's view of runners lives. It stores the runner's DID, their onion address, and their approval/ban status. **No personal information.**

```sql
CREATE TABLE runner_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runner_did TEXT NOT NULL UNIQUE,
  onion_address TEXT NOT NULL,
  display_name TEXT,
  approved_at INTEGER,
  banned_at INTEGER,               -- NULL if not banned
  ban_reason TEXT,                 -- 'abuse', 'non_delivery', etc.
  total_orders_completed INTEGER DEFAULT 0,  -- Aggregated by relay
  last_active_at INTEGER
);
```

**Important**: The admin does **not** know which runner is which person. The `runner_did` is a pseudonym. The admin can ban a DID, but the runner can generate a new DID and re-apply. You mentioned this is acceptable because runners are people you know personally — you would not re-approve them.

### Disputes Table

When a customer reports a non-delivery, the admin can review the proof bundle. This table tracks disputes.

```sql
CREATE TABLE disputes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,          -- Order UUID (opaque to admin)
  customer_did TEXT NOT NULL,
  runner_did TEXT NOT NULL,
  reason TEXT NOT NULL,            -- 'non_delivery', 'wrong_item', 'other'
  proof_cid TEXT,                  -- CID of the proof bundle (if uploaded)
  status TEXT DEFAULT 'open'
    CHECK(status IN ('open', 'resolved', 'dismissed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  admin_notes TEXT
);
```

**How the admin reviews proof**: The admin enters the `proof_cid` into the dashboard. The dashboard retrieves the encrypted bundle from IPFS, the admin enters the order-specific decryption key (which the customer shares with the admin **only for this dispute**), and the admin verifies the photo and location proof. The admin does **not** have a master key.

### Strikes Table

Tracks customer strikes issued by the admin.

```sql
CREATE TABLE customer_strikes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_did TEXT NOT NULL,
  reason TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  issued_by_admin INTEGER DEFAULT 1,
  notes TEXT
);
```

### Platform Settings Table

Admin-configurable settings (e.g., platform fee percentage, default payment window).

```sql
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Seed
INSERT INTO platform_settings (key, value) VALUES
  ('platform_fee_percent', '5'),
  ('payment_window_minutes', '15'),
  ('order_purge_days', '90');
```

---

## Part IV: Encryption & Key Management

### Database Encryption Keys

| Database | Key Storage | Encryption |
|----------|-------------|------------|
| Customer App DB | `expo-secure-store` (Keychain/Keystore) | SQLCipher AES-256 |
| Runner App DB | `expo-secure-store` (Keychain/Keystore) | SQLCipher AES-256 |
| Admin Dashboard DB | Environment variable + OS-level protection | SQLCipher AES-256 |

**Key generation** (on first launch of each app):
```typescript
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const dbKey = await Crypto.getRandomBytesAsync(32); // 256-bit
await SecureStore.setItemAsync('damz_db_key', 
  Buffer.from(dbKey).toString('hex'),
  {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
  }
);
```

### Monero Seed Storage

The Monero seed is **never** stored in the SQLCipher database. It lives only in `expo-secure-store` with biometric authentication required.

```typescript
await SecureStore.setItemAsync('damz_monero_seed', mnemonic, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: 'Authenticate to access your Monero wallet',
});
```

### Proof Bundle Encryption

Proof bundles are encrypted **before** upload using AES-256-GCM. The key is derived from the order ID via HKDF.

```typescript
const proofKey = await Crypto.subtle.deriveKey(
  { name: 'HKDF', hash: 'SHA-256', salt: orderIdBytes, info: 'damz-proof' },
  masterKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);
```

The customer's app derives the same key from the order ID (which both parties know). The admin can derive it only if the customer shares the order ID.

---

## Part V: Data Lifecycle & Purge Rules

| Data Type | Retention | Purge Trigger |
|-----------|-----------|---------------|
| Orders | 90 days after `confirmed` | Background job on app launch |
| Messages | 90 days after order confirmed | Cascading delete with order |
| Proof bundle CID (local) | 90 days | Cleared with order |
| Proof bundle (IPFS) | 90 days | Unpin request to IPFS |
| Runner contacts | Indefinite | User-initiated |
| Customer strikes | Indefinite | User-initiated |
| Wallet metadata | Indefinite | User-initiated wipe |
| Admin disputes | 1 year | Admin-initiated |

**Purge implementation**:
```typescript
// Runs on app launch and every 24 hours
async function purgeExpiredData() {
  const cutoff = Date.now();
  await database.write(async () => {
    await database.get('orders')
      .query(Q.where('purge_after', Q.lt(cutoff)))
      .destroyAllPermanently();
    // Messages cascade-delete via FK constraint
  });
  await database.adapter.unsafeResetDatabase(); // VACUUM
}
```

---

## Part VI: Summary of Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Local DB engine | WatermelonDB + SQLCipher | Reactive, offline-first, AES-256 |
| Key storage | `expo-secure-store` | Hardware-backed, biometric-gated |
| Seed storage | Never in DB | Keychain/Keystore only |
| Admin DB | Server-side SQLite/PostgreSQL | Web dashboard, Tor-hidden |
| Runner registry | DID + onion address only | No personal info |
| Catalog | Fixed 7 items, runner sets price | No inventory counts |
| Strikes | Local on customer, admin-issued | No central reputation |
| Proof bundles | IPFS + client-side AES-GCM | Admin needs order key to decrypt |
| Purge | 90 days after confirmation | No legal retention requirement |
| Monero | Prepared, not active | Schema fields exist, functionality stubbed |

---

## What's Prepared for Monero (But Not Active)

The schema includes all Monero fields (`monero_subaddress`, `payment_txid`, `wallet_metadata`) but the actual gateway integration, rate oracle, and payment monitoring are stubbed. When you're ready to activate Monero:

1. Deploy `MoneroPay` as a `.onion` hidden service.
2. Replace the stub in the order creation flow with a call to the gateway.
3. Add a background service to monitor the `receive` endpoint.
4. Uncomment the wallet metadata sync logic.

The database schema does not need to change — only the application layer.