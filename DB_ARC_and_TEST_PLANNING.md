# DAMZ — Database Architecture & Testing Specification

**Document**: DB-ARCH-001 & TEST-001
**Project**: DAMZ
**Version**: 2.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

> ⚠️ **Superseded (2026-10-04)**: **Part I (Database Architecture) below is superseded** by
> `DB_LAYOUT_AND_ARCH.md` v2, which came out of the `grill-with-docs` refinement session
> (`REFINEMENT_SESSION.md`). Part I is kept for history only. **Part II (Testing Strategy)
> is unaffected and still current.**


## Part I: Database Architecture

### 1.1 Design Principles

The database architecture for DAMZ must satisfy four non-negotiable constraints derived from the threat model:

1. **Zero Plaintext at Rest** — Every byte of user data (DIDs, order records, chat history, wallet seeds, proof bundles) must be encrypted on device before it touches any storage layer.

2. **No Central User Database** — There is no central user profile/account database or central store of order, chat, or proof content. The separate Admin service holds bounded pseudonymous moderation DIDs and, under ADR-0029, only the target app DID and command metadata required for managed-Android DAMZ app-data wipes; it holds zero rows of order, message, or proof data. The "database" is a combination of encrypted local storage and content-addressed decentralized storage (IPFS). This Part I is superseded by `DB_LAYOUT_AND_ARCH.md`; this precise boundary is also recorded in ADR-0041.

3. **Offline-First** — Runners operate in areas with intermittent connectivity. Every operation must succeed locally and sync when connectivity is restored.

4. **Ephemeral Where Possible** — Order chats, delivery proofs, and payment records have a defined lifecycle. Once the delivery is confirmed and the customer has retrieved the proof, the data should be eliminable.

### 1.2 Storage Layers

DAMZ uses a **three-tier storage architecture**:

| Tier | Technology | Purpose | Encryption |
|------|-----------|---------|------------|
| **Tier 1: Local Encrypted DB** | WatermelonDBCipher (SQLCipher fork) | Structured data: orders, DIDs, wallet metadata, session state | AES-256 (SQLCipher) |
| **Tier 2: Secure Key Store** | Platform Keychain/Keystore; `expo-secure-store` for general keys; native `SecureMemory` for Monero wallet secrets (ADR-0028) | Encryption keys, independent Customer/Runner wallet secrets | Hardware-backed at rest; wallet-secret plaintext remains native-only |
| **Tier 3: Decentralized Blob Store** | IPFS (Helia or Meshkit S3 backend) | Encrypted delivery-evidence bundles: photos, ZK proofs or explicitly non-ZK coarse-geohash fallback, signed attestations | AES-256-GCM (client-side, before upload) |

#### Tier 1: Local Encrypted Database — WatermelonDBCipher

WatermelonDB is a high-performance reactive database for React Native built on SQLite. The `WatermelonDBCipher` fork replaces standard SQLite with SQLCipher, enabling full database encryption by passing a secret key at initialization.

**Why WatermelonDB over alternatives:**

- **Reactive**: Components subscribe to query results and re-render automatically when data changes. Critical for the runner's order list and the customer's delivery status.
- **Lazy-loading**: Records are loaded on-demand, not eagerly. Essential for mobile memory constraints.
- **SQLCipher integration**: AES-256 encryption of the entire database file with minimal overhead (5–15% write overhead in typical workloads).
- **Offline-first**: Designed for apps that work without network connectivity.

**Why not `expo-sqlite` or `op-sqlite`:**

`expo-sqlite` does not support SQLCipher natively. `op-sqlite` has an `op-sqlcipher` fork but lacks WatermelonDB's reactive query layer and sync primitives.

**Schema design:**

The database schema is entirely local. There is no server-side schema to reconcile.

```sql
-- Identity (created once, never leaves device except as DID)
CREATE TABLE identity (
  id TEXT PRIMARY KEY,           -- DID string
  did_document TEXT,            -- DID document JSON (encrypted by SQLCipher)
  created_at INTEGER NOT NULL,
  display_name TEXT             -- User-chosen pseudonym (optional)
);

-- Contacts (runners or customers the user has interacted with)
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,           -- Signal Protocol ProtocolAddress
  did TEXT NOT NULL,             -- Their DID
  display_name TEXT,
  onion_address TEXT,            -- Their Tor .onion service
  signal_identity_key BLOB,      -- Their Signal identity key
  last_seen INTEGER
);

-- Orders (the core transactional record)
CREATE TABLE orders (
  id TEXT PRIMARY KEY,           -- Order UUID
  customer_did TEXT NOT NULL,
  runner_did TEXT NOT NULL,
  items TEXT NOT NULL,           -- JSON: [{name, quantity}]
  total_xmr TEXT NOT NULL,       -- Monero amount in piconero (string to avoid float)
  total_zar TEXT,                -- ZAR equivalent at time of order
  status TEXT NOT NULL CHECK(status IN (
    'pending_payment', 'paid', 'accepted', 'in_transit', 
    'delivered', 'confirmed', 'cancelled', 'expired'
  )),
  monero_subaddress TEXT,        -- Generated subaddress for this order
  payment_txid TEXT,             -- Monero transaction ID (set when detected)
  proof_cid TEXT,                -- IPFS CID of encrypted proof bundle
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER             -- Order expiry (15 minutes for payment)
);

-- Messages (Signal Protocol envelopes, encrypted at rest by SQLCipher)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  sender_did TEXT NOT NULL,
  recipient_did TEXT NOT NULL,
  envelope BLOB NOT NULL,        -- Signal Protocol ciphertext
  sent_at INTEGER NOT NULL,
  received_at INTEGER,
  read_at INTEGER
);

-- Wallet metadata only (no Monero wallet secrets; secrets are in Tier 2 via native SecureMemory)
CREATE TABLE wallet_metadata (
  id INTEGER PRIMARY KEY CHECK(id = 1),  -- Singleton row
  primary_address TEXT NOT NULL,
  account_index INTEGER NOT NULL DEFAULT 0,
  restore_height INTEGER,
  last_sync_height INTEGER
);
```

**Encryption key management:**

The SQLCipher database key is generated on first launch using `expo-crypto`'s `getRandomBytes(32)` (256-bit key). This key is stored in `expo-secure-store` (Tier 2), which uses the iOS Keychain or Android Keystore for hardware-backed protection.

```typescript
// On first launch
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const dbKey = await Crypto.getRandomBytesAsync(32);
const dbKeyHex = Buffer.from(dbKey).toString('hex');

await SecureStore.setItemAsync('damz_db_key', dbKeyHex, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true, // Biometric gate
});

// On subsequent launches
const dbKeyHex = await SecureStore.getItemAsync('damz_db_key', {
  requireAuthentication: true,
});

// Initialize WatermelonDB with SQLCipher
const database = new Database({
  adapter: new SQLiteAdapter({
    dbName: 'damz',
    cipherKey: dbKeyHex, // Passed to SQLCipher
  }),
});
```

#### Tier 2: Secure Key Store

The platform Keychain/Keystore protects secrets at rest. `expo-secure-store` provides JavaScript-facing access for non-wallet keys; Monero wallet-secret plaintext is the exception and is accessed directly by native `SecureMemory` (ADR-0028).

- **SQLCipher database key** — The key that unlocks Tier 1.
- **Monero wallet secrets (Customer and Runner)** — The complete 25-word mnemonic, spend keys, and any locally persisted private view key. Each app stores on-device copies only in the platform Keychain/Keystore and accesses plaintext through native `SecureMemory`; no wallet secret is stored in SQLCipher or returned to JavaScript. The separate gateway-side Runner view key is described in §1.6.
- **DID private keys** — The Ed25519 keys for the user's DID.
- **Signal Protocol identity keys** — The long-term identity key pair.

**Hardware-backed protection:**

Keychain/Keystore access controls and hardware-backed protection vary by platform and
device. These controls protect data at rest; they do not make plaintext in a live process
immune to a privileged memory reader. `mlock()` and zeroization reduce stale wallet-secret
exposure but do not eliminate active-operation capture (see `THREAT-MODEL.md` and ADR-0028).

**Monero wallet-secret API (ADR-0028):** There is intentionally no JavaScript
`SecureStore.setItemAsync` or `getItemAsync` call for the seed, spend key, or private view
key. Native `SecureMemory` reads and writes the Keychain/Keystore directly. Native UI
displays and accepts the complete 25-word phrase for backup and recovery; JavaScript
receives only non-secret status and metadata. JavaScript-facing `expo-secure-store` remains
available for non-wallet keys.

#### Tier 3: Decentralized Blob Store (IPFS)

Delivery-evidence bundles (photo + hardware signature + the location result actually produced: a ZK proof or an explicitly non-ZK coarse-geohash fallback) are stored encrypted on IPFS. Encryption happens **on the device before upload** using AES-256-GCM. The IPFS node or S3-compatible backend only ever sees ciphertext.

**Two implementation paths:**

**Path A: `@ipfs-meshkit/meshkit` (S3-compatible backend)**

Meshkit provides a TypeScript SDK with built-in client-side AES-256-GCM encryption. It supports an S3-compatible backend that works in React Native without a local IPFS daemon. All encrypted payloads use the EMSH wire format, with key derivation via PBKDF2-SHA256 (200,000 iterations).

```typescript
import { createS3Client } from '@ipfs-meshkit/meshkit';

const client = createS3Client({
  accessKeyId: process.env.STORAGE_KEY!,
  secretAccessKey: process.env.STORAGE_SECRET!,
  bucket: 'damz-proofs',
  endpoint: 'https://<your-s3-compatible-endpoint>',
});

// Upload with automatic AES-256-GCM encryption
const proofBundle = /* encrypted proof bundle */;
const cid = await client.upload(proofBundle);
// Store cid in orders.proof_cid
```

**Path B: Helia (full IPFS node in React Native)**

Helia is an implementation of the IPFS protocol written entirely in TypeScript that runs in React Native. Helia v5 has connection management tuned for low-bandwidth/CPU environments. It requires a custom storage adapter for React Native (since IndexedDB is unavailable).

```typescript
import { createHelia } from 'helia';
import { createOrbitDB } from '@orbitdb/core';

// Custom storage adapter for React Native
const rnStorage = {
  get: async (key) => { /* AsyncStorage/WatermelonDB read */ },
  put: async (key, value) => { /* AsyncStorage/WatermelonDB write */ },
  del: async (key) => { /* Delete */ },
  // ... other required methods
};

const helia = await createHelia({ storage: rnStorage });
```

**Recommendation for v1**: Use Meshkit's S3 path. It is simpler, requires no IPFS daemon, and the S3 backend can be a self-hosted MinIO instance running behind Tor. Migrate to Helia in v2 when OrbitDB's React Native support matures.

### 1.3 No OrbitDB (Updated Decision)

In the earlier spec, I proposed OrbitDB for inventory management. Since inventory management is removed, OrbitDB's primary use case is gone. The remaining potential use — decentralized order synchronization between runners — is not necessary because **orders are peer-to-peer transactions between one customer and one runner**. There is no shared state that multiple parties must converge on.

**OrbitDB integration with React Native also remains problematic.** The `indexedDB` dependency fails in React Native, and while a custom storage provider can work around it, the `throwIfAborted` error and CBOR decode issues remain unresolved in the community. Given that inventory management is out of scope, OrbitDB is not worth the integration risk.

**If future requirements demand multi-runner order visibility**, revisit OrbitDB with Helia as the IPFS backend.

### 1.4 Database Lifecycle

| Data Type | Storage | Lifetime | Deletion Trigger |
|-----------|---------|----------|------------------|
| Identity (DID) | Tier 1 (WatermelonDB) + Tier 2 (keys) | App lifetime | User-initiated wipe |
| Monero wallet secrets | Tier 2 only, native-only plaintext access | App lifetime | User-initiated wipe |
| Order record | Tier 1 | 90 days after completion | Automatic purge job |
| Order messages | Tier 1 | 30 days after order completion | Automatic purge job |
| Delivery proof CID | Tier 1 | 90 days | Automatic purge job |
| Proof bundle blob | Tier 3 (IPFS/S3) | 90 days | Pinning service TTL |
| Relay message queue | Relay memory only | Until retrieved or expired | Automatic (relay restart) |

**Purge implementation**: A background job runs on app launch and every 24 hours. It queries orders older than the retention window, deletes associated messages and CID records, and issues an unpin request to the IPFS pinning service. The SQLCipher database is then `VACUUM`ed to reclaim space.

### 1.5 Sync Strategy

Since there is no central database, "sync" means two things:

1. **Order state sync**: When a runner accepts an order, marks it delivered, or completes it, the state change is sent to the customer via the Signal Protocol messaging layer. The customer's app updates its local WatermelonDB record. There is no merge conflict because each side owns different fields: the runner owns `status`, the customer owns `confirmed`.

2. **Proof bundle sync**: The runner uploads the encrypted proof bundle to IPFS and sends the CID to the customer. The customer retrieves the bundle on demand. There is no pre-fetching; the bundle is retrieved only when the customer confirms delivery.

**No bidirectional replication.** Each device's database is authoritative for the data it creates. The other device learns about changes via messages, not via database sync.

### 1.6 Monero Wallet Storage

**Critical distinction (ADR-0028)**: The Customer and Runner apps each own a separate local Monero wallet. Its complete 25-word mnemonic, spend key, and any locally persisted private view key must never be stored in SQLCipher or routed through JavaScript. Each on-device secret is held at rest in iOS Keychain / Android Keystore and accessed directly by native `SecureMemory`. The separate AcceptXMR gateway holds the Runner's private view key in encrypted view-only configuration and never receives a spend key (ADR-0009; `services/gateway/SPEC.md`). Each app's SQLCipher database stores only **that device's non-secret wallet metadata**: primary address, account index, restore height, last sync height.

**View key handling**: The local private view key remains optional to persist. If persisted, it may be encrypted using a PIN-derived HKDF key as the narrow exception in ADR-0028. PIN collection, derivation, Keychain/Keystore access, and key use occur only inside native `SecureMemory`; neither PIN nor plaintext key may enter JavaScript or JSI. The app can omit the view key and rely on the Monero gateway for balance and transaction detection.

**Reference implementations:**

- **Monerujo** (Android): Stores wallet files in app-internal storage accessible only by the app on non-rooted devices. Wallet data is encrypted with the wallet password using the Monero encryption scheme.
- **MyMonero**: Android data is encrypted and saved using AndroidKeyStore and SharedPreferences. iOS uses SwiftKeychainWrapper. All secret data is encrypted with AES-256 symmetric key directly on the device.

DAMZ uses platform secure storage for the seed at rest and native `SecureMemory` for all plaintext seed access; each app's own SQLCipher database stores only its non-secret wallet metadata.

### 1.7 Database Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Order UI     │  │ Chat UI      │  │ Wallet UI                │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                        │                │
│         └─────────────────┼────────────────────────┘                │
│                           │                                         │
│                    ┌──────▼───────┐                                  │
│                    │ WatermelonDB │  (Reactive query layer)          │
│                    │ Query Engine │                                  │
│                    └──────┬───────┘                                  │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                    ┌──────▼───────┐                                  │
│                    │ SQLCipher    │  (AES-256 encryption)            │
│                    │ Adapter      │                                  │
│                    └──────┬───────┘                                  │
│                           │                                         │
│  ┌────────────────────────┼────────────────────────┐                │
│  │                        │                        │                │
│  ▼                        ▼                        ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ identity     │  │ orders       │  │ messages                 │  │
│  │ contacts     │  │ wallet_meta  │  │                          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                     │
│                    TIER 1: ENCRYPTED SQLCIPHER DB                   │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ SQLCipher key (32 bytes)
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                    ┌──────▼───────┐                                  │
│                    │ OS Secure    │  (Keychain/Keystore; native       │
│                    │ Store        │   SecureMemory for wallet seeds)│
│                    └──────┬───────┘                                  │
│                           │                                         │
│  ┌────────────────────────┼────────────────────────┐                │
│  │                        │                        │                │
│  ▼                        ▼                        ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ SQLCipher    │  │ Monero keys  │  │ DID private keys         │  │
│  │ DB key       │  │ (native only)│  │ Signal identity keys     │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                     │
│                    TIER 2: SECURE KEY STORE                         │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ Encrypted proof bundle (AES-256-GCM)
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                    ┌──────▼───────┐                                  │
│                    │ Meshkit S3   │  (Encryption before upload)      │
│                    │ Client       │                                  │
│                    └──────┬───────┘                                  │
│                           │                                         │
│                           ▼                                         │
│                    ┌──────────────┐                                  │
│                    │ MinIO / S3   │  (Self-hosted, behind Tor)       │
│                    │ (IPFS-backed)│                                  │
│                    └──────────────┘                                  │
│                                                                     │
│                    TIER 3: DECENTRALIZED BLOB STORE                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.8 Database Tool Matrix

| Requirement | Tool | Version | Source |
|-------------|------|---------|--------|
| Reactive local DB | WatermelonDB | 0.27+ | `github.com/Nozbe/WatermelonDB` |
| SQLCipher fork | WatermelonDBCipher | 0.27+ | `github.com/10play/WatermelonDBCipher` |
| General secure key store | `expo-secure-store` | 14+ | Non-wallet keys; not used for Monero seed plaintext |
| Native wallet secret boundary | `SecureMemory` C/C++ module (ADR-0028) | Project module, planned | Native Keychain/Keystore access; no wallet key or PIN through JavaScript |
| Encryption (AES-256-GCM) | `@ipfs-meshkit/meshkit` | 1.2+ | `github.com/IPFS-Meshkit/meshkit0` |
| IPFS (v2) | Helia | 5+ | `helia.io` |
| Monero crypto | `react-native-mymonero-core` | 0.4+ | `github.com/EdgeApp/react-native-mymonero-core` |
| Signal Protocol | `react-native-libsignal-client` | 0.5+ | `github.com/p-num/react-native-libsignal-client` |
| UI Framework | React Native Reusables + NativeWind + Reanimated 3 | Latest | `github.com/react-native-reusables/reusables`, `nativewind.dev`, `docs.swmansion.com/react-native-reanimated` |


## Part II: Testing Strategy (V-Model + STLC)

### 2.1 Methodology Overview

DAMZ follows the **V-Model** for software development, where each development phase on the left side has a corresponding verification/testing phase on the right side. Testing activities are planned **in parallel** with development, not after it. This aligns with the Software Testing Life Cycle (STLC), which defines the phases: Requirement Analysis → Test Planning → Test Case Design → Test Environment Setup → Test Execution → Test Cycle Closure.

The V-Model is particularly suited to DAMZ because:
- **Safety-critical components** (Monero payments, location proofs, encrypted storage) require early test planning.
- **Security testing** must be integrated at every level, not bolted on.
- **The test hierarchy** (unit → integration → system → acceptance) maps cleanly to the layered architecture.

### 2.2 V-Model Mapping for DAMZ

```
LEFT SIDE (Development)                    RIGHT SIDE (Testing)
─────────────────────────────────────────────────────────────────────
Requirements Analysis ──────────────────→ Acceptance Testing
  (Threat model, user stories)              (Penetration testing, 
                                             anonymity verification)

System Design ──────────────────────────→ System Testing
  (Architecture, data flow)                 (E2E order lifecycle, 
                                             Tor transport verification)

High-Level Design ──────────────────────→ Integration Testing
  (Module interfaces, APIs)                 (Signal + Tor integration,
                                             Monero + UI integration)

Low-Level Design ───────────────────────→ Unit Testing
  (Functions, classes)                      (Jest, RNTL, crypto 
                                             primitive tests)

                    ┌─────────────┐
                    │  CODING     │
                    └─────────────┘
```

### 2.3 STLC Phases for DAMZ

| Phase | Activities | Deliverables |
|-------|-----------|--------------|
| **1. Requirement Analysis** | Review threat model, identify testable requirements from security goals | Requirements Traceability Matrix (RTM) |
| **2. Test Planning** | Define scope, strategy, tools, environments, schedule | Test Plan document |
| **3. Test Case Design** | Design test cases using EP, BVA, decision tables, state transition | Test Case Repository |
| **4. Test Environment Setup** | Configure Tor testnet, Monero stagenet, IPFS local node, Android emulator/iOS simulator | Environment Setup Guide |
| **5. Test Execution** | Run test suites, log defects, track coverage | Test Execution Reports, Defect Logs |
| **6. Test Cycle Closure** | Evaluate coverage, document lessons learned, archive artifacts | Test Summary Report |

### 2.4 Testing Tools by Layer

#### Unit Testing (Jest + React Native Testing Library)

**Jest** is the default test runner in every React Native project. It runs in Node.js, supports TypeScript natively, and handles mocking, snapshots, and coverage.

**React Native Testing Library (RNTL)** renders components in a simulated environment and queries elements by text, testID, or accessibility label. It tests component behavior, not implementation.

**What to unit test in DAMZ:**

- **Crypto primitives**: Verify HKDF key derivation, AES-GCM encrypt/decrypt round-trip, Monero address decoding.
- **Data models**: Test WatermelonDB model creation, validation, and query logic.
- **Signal Protocol wrappers**: Test `SignalClient` session establishment, encryption, decryption with mock prekey bundles.
- **ZK proof input validation**: Test coordinate validation, tolerance bounds, proof generation failure paths.
- **Order state machine**: Test valid and invalid state transitions (pending → paid → accepted → delivered → confirmed).

```typescript
// Example: Test order state machine
import { orderReducer } from '../src/orders/reducer';

test('order cannot transition from pending_payment to delivered', () => {
  const state = { status: 'pending_payment' };
  const action = { type: 'MARK_DELIVERED' };
  const next = orderReducer(state, action);
  expect(next.status).toBe('pending_payment'); // Unchanged
});
```

#### Integration Testing (RNTL + Mocked Native Modules)

Integration tests verify that multiple components work together. In React Native, native modules (camera, GPS, Tor, NFC) must be mocked because they don't exist in the Jest Node.js environment.

**What to integration test in DAMZ:**

- **Signal Protocol + messaging layer**: Two `SignalClient` instances exchange encrypted messages through a mocked relay.
- **Monero subaddress generation + payment flow**: Mock `react-native-mymonero-core` bridge, verify subaddress derivation and payment detection callback.
- **Proof bundle creation**: Mock camera, GPS, and file system; verify that photo is signed, encrypted, and uploaded correctly.
- **Tor transport**: Mock `react-native-nitro-tor`; verify that HTTP requests are routed through the SOCKS proxy.

```typescript
// jest.setup.js — mock native modules
jest.mock('react-native-nitro-tor', () => ({
  RnTor: {
    startTorIfNotRunning: jest.fn().mockResolvedValue({ is_success: true }),
    httpGet: jest.fn().mockResolvedValue({ status_code: 200, body: 'ok' }),
  },
}));

jest.mock('react-native-mymonero-core', () => ({
  __esModule: true,
  default: {
    decodeAddress: jest.fn(),
    generateWallet: jest.fn(),
    createTransaction: jest.fn(),
  },
}));
```

#### End-to-End Testing (Detox or Maestro)

For React Native, the E2E landscape in 2026 is dominated by **Maestro** for simplicity and **Detox** for React Native-specific reliability.

| Framework | Setup | Best For | RN Compatibility |
|-----------|-------|----------|------------------|
| **Detox** | Moderate | React Native apps, complex flows | Gray-box, wired into RN bridge |
| **Maestro** | Easy | Quick tests, visual validation | YAML-based, cross-platform |
| **Appium** | Complex | Cross-platform, existing infrastructure | Heavyweight |

**Recommendation**: Use **Maestro** for v1. Its YAML-based test definitions are readable by non-developers, setup is minimal, and it supports both iOS and Android. Detox is the fallback if Maestro proves too flaky for the Tor-dependent flows.

**What to E2E test in DAMZ:**

- **Complete order lifecycle**: Customer places order → runner accepts → payment confirmed → runner delivers → customer confirms.
- **Tor connectivity**: App starts Tor daemon, connects to `.onion` relay, exchanges a message.
- **Biometric authentication**: Seed and spend-key access is gated by the platform biometric prompt inside native `SecureMemory`; the optional private view key may use the documented native PIN-derived HKDF exception. No wallet secret or PIN crosses into JavaScript.
- **Offline behavior**: Runner app works without network, syncs when connectivity is restored.
- **Data purge**: Orders older than 90 days are automatically deleted.
- **Customer screens**: Onboarding (native wallet setup/backup) → Discover → Item Selection → Address → Review → Payment (local wallet send) → Tracking → Chat → Verification → History → Disputes → Settings
- **Runner screens**: Onboarding (native wallet setup/backup) → Dashboard → Price List → Order Requests → Accept → Active Order → Capture → Upload → Wallet → Settings
- **Converter flow**: ZAR→XMR (XmrBazaar deep link) → Customer wallet → Order payment; BTC→XMR (UnstoppableSwap) → Customer wallet → Order payment
- **Dispute flow**: Raise → Admin review → Proof key share → Resolution → Refund
- **Customer wallet flow**: Native 25-word phrase generation/display/restore → biometric unlock → send XMR to Runner payment destination
- **Runner wallet flow**: Native 25-word phrase generation/display/restore → biometric unlock → receive/subaddress → withdraw (XMR→ZAR) → duress PIN
- **Error states**: Tor down, relay down, payment expired, ZK proof failed, photo attestation failed

```yaml
# Maestro flow: Place an order
appId: com.damz.customer
---
- launchApp
- tapOn: "Browse"
- tapOn: "Cabbage"
- tapOn: "Add to Order"
- tapOn: "Place Order"
- assertVisible: "Payment Required"
- tapOn: "Pay with Monero"
- assertVisible: "Waiting for confirmation..."
```

#### Security Testing (OWASP MASVS)

The **OWASP Mobile Application Security Verification Standard (MASVS)** defines eight categories of mobile security controls. DAMZ must verify compliance against each relevant category:

| MASVS Category | DAMZ Relevance | Verification Method |
|----------------|----------------|---------------------|
| **MASVS-STORAGE** | SQLCipher encryption, Keychain/Keystore usage | Static analysis, runtime inspection |
| **MASVS-CRYPTO** | AES-256-GCM, X25519, Ed25519, HKDF | Code review, test vectors |
| **MASVS-AUTH** | Biometric gating for seed/key access | Manual testing, instrumentation |
| **MASVS-NETWORK** | Tor transport, no clearnet fallback | Traffic analysis, proxy verification |
| **MASVS-PLATFORM** | No unnecessary permissions, safe IPC | Permission audit, manifest review |
| **MASVS-CODE** | Dependency currency, no hardcoded secrets | `narvy-cli` SAST scan |
| **MASVS-RESILIENCE** | Anti-tampering, root detection | Manual testing on rooted device |
| **MASVS-PRIVACY** | No analytics SDK, data minimization | SDK inventory, network capture |

**Tool: `narvy-cli`**

Narvy CLI is a free, local static application security testing (SAST) scanner. It runs entirely on your machine, needs no account, and finds hardcoded secrets, insecure configuration, weak cryptography, SSRF, and injection vulnerabilities in Android APK/AAB, iOS IPA, and source code.

```bash
# Scan the DAMZ Android build
narvy scan app-release.apk --output sarif --file results.sarif

# Scan the DAMZ source code
narvy scan ./damz-app/

# Verify no hardcoded secrets
narvy scan ./damz-app/ | grep -i "hardcoded"
```

**Tool: MobARK**

MobARK is a self-hosted security research platform for Android and iOS apps. It decompiles APK/IPA files with `jadx`, runs static analysis with Semgrep and Gitleaks, and includes an AI agent for investigating findings.

### 2.5 Test Case Design Techniques (Applied to DAMZ)

#### Equivalence Partitioning

**Example: Monero payment amount validation**

The payment amount must be > 0 and ≤ 10,000 XMR (a reasonable upper bound for a medicine order).

- **Partition 1 (Invalid)**: amount ≤ 0 → test with 0, -1
- **Partition 2 (Valid)**: 0 < amount ≤ 10,000 → test with 1, 500, 10,000
- **Partition 3 (Invalid)**: amount > 10,000 → test with 10,001

#### Boundary Value Analysis

**Example: Order expiry timer**

The order payment window is 15 minutes (900 seconds).

- **Boundary 1**: 899 seconds → order still valid
- **Boundary 2**: 900 seconds → order valid at exact boundary
- **Boundary 3**: 901 seconds → order expired

#### Decision Tables

**Example: Delivery confirmation decision**

Conditions:
- C1: Customer confirms receipt
- C2: Proof bundle is retrievable
- C3: Location proof is valid
- C4: Photo signature is valid

Actions:
- A1: Mark order as confirmed
- A2: Request re-delivery
- A3: Flag for manual review

With 4 conditions, there are 2⁴ = 16 combinations. The decision table ensures all combinations are tested, including edge cases like "customer confirms but proof is invalid."

#### State Transition Testing

**Example: Order state machine**

States: `pending_payment`, `paid`, `accepted`, `in_transit`, `delivered`, `confirmed`, `cancelled`, `expired`

Valid transitions:
- `pending_payment` → `paid` (payment detected)
- `pending_payment` → `expired` (15-minute timeout)
- `paid` → `accepted` (runner accepts)
- `accepted` → `in_transit` (runner starts delivery)
- `in_transit` → `delivered` (runner uploads proof)
- `delivered` → `confirmed` (customer verifies proof)
- Any → `cancelled` (user cancellation)

Invalid transitions (must be rejected):
- `pending_payment` → `delivered`
- `confirmed` → `pending_payment`
- `expired` → `paid`

Tests must verify both valid paths and invalid attempts.

### 2.6 Test Environments

| Environment | Purpose | Setup |
|-------------|---------|-------|
| **Local (Jest)** | Unit + integration tests | Node.js, mocked native modules |
| **Monero Stagenet** | Payment flow testing | `monerod --stagenet`, `monero-wallet-cli --stagenet` |
| **Tor Testnet** | Transport testing | Local Tor daemon, test `.onion` services |
| **Android Emulator** | E2E + UI testing | Android Studio AVD, API 28+ |
| **iOS Simulator** | E2E + UI testing | Xcode 16+, iOS 16+ |
| **Physical Device** | Security + biometric testing | Pixel with GrapheneOS, iPhone with Secure Enclave |

### 2.6.1 Contract Testing

**Admin API**: OpenAPI spec validation — generate TypeScript client from spec, validate responses in CI.
**Relay Protocol**: Blob format schema (JSON Schema) — validate PUT/GET request/response in CI.
**Signal Protocol**: Test vectors from libsignal test suite — verify encryption/decryption round-trip.
**Monero**: Test vectors from Monero test suite — verify subaddress derivation, transaction creation.

### 2.6.2 Native Secure-Memory Test Gate (ADR-0028)

These are planned acceptance tests for both mobile apps; they remain pending until their
wallet phases. No runtime tests are run as part of this documentation directive.

- **Bridge contract — TC-SEC-MEM-01 to TC-SEC-MEM-04**: inspect the exported API and
  instrumentation to verify that no seed, spend key, private view key, or view-key PIN is
  returned to or accepted from JavaScript/JSI as a string, typed array, or other JS-managed
  value; JavaScript receives only non-secret status and metadata. Confirm no wallet-secret
  remnants in the JS heap, logs, or crash reports after wallet operations.
- **Native phrase UI — TC-WALLET-01 to TC-WALLET-04**: verify that generation, display,
  entry, and restoration of the full 25-word Monero mnemonic complete in native UI/module
  code and remain usable for new-device recovery without the phrase entering
  JS-managed state.
- **Buffer lifecycle — TC-SEC-MEM-05 to TC-SEC-MEM-08**: verify `mlock()` where supported
  and call `secure_memset()` before release on success, error, and cancellation paths;
  verify prompt release of native/JSI handles and no stale secret buffer after an operation.
- **Private view-key exception — TC-SEC-MEM-09 to TC-SEC-MEM-11**: when the optional
  private view key is persisted, verify PIN-derived HKDF and secure-store access run wholly
  inside native `SecureMemory`; verify seed/spend-key operations remain biometric-only and
  no key or PIN is exposed to JavaScript.
- **Forensic-memory check**: after wallet operations, inspect the unlocked app's JS heap and
  captured memory for wallet-secret remnants. The test must confirm no seed, spend key, or
  private view key or view-key PIN is present in JavaScript-managed memory. It must not
  claim protection from a privileged live capture during an active operation; that remains a documented
  residual risk.
- **Platform gate**: test the minimum supported iOS and Android versions, verify lock
  limits/zeroization behavior, and apply the approved platform fallback if `mlock()` is
  unavailable (OQ-SEC-MEM-001).

### 2.6.3 Managed Android Remote-Wipe Test Gate (ADR-0029)

These are planned acceptance tests for both mobile apps and the Admin service. They remain
pending until their Customer/Runner native-wallet and Admin phases; no runtime tests are run
as part of this documentation directive.

- **Eligibility and schema — TC-SEC-WIPE-01**: issue commands only for verified enrolled
  managed Android installations; reject iOS, unmanaged Android, an absent/invalid
  enrollment proof, or a DID/app-role mismatch. Confirm `wipe_pending` is Admin-only and
  the client schema remains exactly 19 tables.
- **Command integrity — TC-SEC-WIPE-02**: reject a bad Admin signature, modified target,
  app role, scope, expiry, or nonce; verify command expiry is bounded to 72 hours and that
  a cancelled, expired, replayed, or duplicate command cannot trigger a second wipe.
- **Target delivery and receipts — TC-SEC-WIPE-03**: only the matching target DID/app can
  fetch or acknowledge a command. Verify `accepted` is not shown as completion, and
  `completed` is recorded only after the native handler reports success; if the final
  receipt cannot be sent, do not claim remote completion.
- **Native app-data erase — TC-SEC-WIPE-04**: stop wallet work, zeroize live native wallet
  buffers, remove app-owned Android Keystore/secure-storage wallet credentials and other
  DAMZ-only keys, delete the SQLCipher key and database/WAL/SHM/journal files, and clear
  app-private caches. Confirm a fresh app process cannot reopen the wiped database or
  recover erased keys. Seed, spend key, private view key, and view-key PIN must never enter
  JavaScript/JSI during the wipe.
- **Failure and scope — TC-SEC-WIPE-05 to TC-SEC-WIPE-06**: exercise offline/expired,
  force-stop, interrupted deletion, and missing-receipt cases; verify idempotent retry and
  truthful state. Confirm no factory reset, no iOS/unmanaged-device support, no deletion of
  other app installations or remote/external copies, and no secrets in logs/crash reports.
  Do not claim forensic sanitization of flash storage.
- **Enrollment proof gate**: test the selected Android Enterprise/MDM attestation and
  app-installation-to-DID binding before enabling production issuance (OQ-SEC-WIPE-001).
  Validate minimum supported Android versions and interrupted-wipe behavior before the
  Customer/Runner native-wipe and Admin integration gates (OQ-SEC-WIPE-002).

### 2.6.4 Mobile ZK Backend Compatibility and Fallback Gate (ADR-0030)

These are planned acceptance tests, not executed tests. Mopro/GPU remains disabled until the
circuit and device gates pass. Zakura/CPU remains the supported fallback; if the Zakura port
is unavailable, the existing `@ajna-inc/poe-proofs` CPU prover remains the interim path.

- **Circuit and verifier parity — TC-ZK-BE-01**: run canonical location-proof vectors through
  each supported prover; confirm the circuit statement, public-input encoding, parameters,
  and verification key are identical. Verify both Mopro/GPU and CPU outputs with the
  existing Customer and Admin verifiers. Reject any output that does not verify.
- **Capability selection — TC-ZK-BE-02**: when Mopro/GPU is disabled, unsupported, or not
  validated for a device/circuit combination, prove through CPU without changing the
  statement or sending data to a remote prover.
- **Failure recovery — TC-ZK-BE-03**: simulate Mopro initialization/proving errors,
  unsupported GPU, memory/thermal pressure, timeout, and invalid proof. Confirm a fresh
  Zakura/CPU proof is attempted at the requested precision; if CPU proving/verification
  fails, retain the lower-precision CPU retry (ADR-0027). Coarse geohash is used only when
  CPU proving still fails or exceeds five seconds, and the result is explicitly identified
  as having no ZK proof.
- **Privacy and buffer lifecycle — TC-ZK-BE-04**: inspect network capture, application
  logs, persistent storage, and native/GPU buffer cleanup. Confirm coordinates, witnesses,
  proving keys, and proofs are not sent to a remote accelerator or service, logged, or
  persisted as plaintext; disable the GPU backend if its supported buffer lifecycle cannot
  meet this gate.
- **Device performance and stability — TC-ZK-BE-05**: benchmark both provers on the actual
  DAMZ circuit across the minimum supported Android/iOS matrix, including mid-range Android
  (Pixel 6a class). Record end-to-end proving time, peak memory, thermal throttling, and
  failure rate; do not infer DAMZ performance from Mopro's general benchmarks. The existing
  five-second CPU gate and geohash behavior remain in force.

**Unresolved compatibility inputs**: OQ-ZK-PROVER-001/002 in ADR-0030 are owned by
Admin/Developer and must be resolved at the Phase 6 gate. If circuit compatibility or privacy
requirements cannot be demonstrated, Mopro/GPU remains disabled and the CPU path continues.

### 2.6.5 Fixed Catalog and Editable Price-Prefill Gate (ADR-0004/C20)

These are planned acceptance cases; no runtime tests are run as part of this documentation
directive.

- **Catalog inventory — TC-CAT-01**: both apps expose the same fixed eight catalog items,
  including `Grape Soda (Small Bottle)`, exactly once. Confirm Grape Soda's catalog
  migration adds only the reference item; it does not create a price or delivery-fee row.
  The client schema remains at 19 tables.
- **Prefill and editability — TC-PRICE-PREFILL-01**: the Runner's editor initially suggests
  **R15.00** for Grape Soda and **R20.00** for the delivery-fee field. Verify the Runner can
  edit each value both below and above the suggestion (for example, R14.00 and R19.00) and
  is not rejected solely for being below it. Existing money-format/validity checks still
  apply; the suggestions themselves impose no floor or required amount.
- **Signed values — TC-PRICE-PREFILL-02**: publish valid amounts below the suggestions
  (for example, R14.00 for Grape Soda and R19.00 for the delivery fee), then confirm those
  exact chosen values are included in the DID-signed list and the Customer cache receives
  and verifies them. Also verify a higher value can be published; unedited suggestions are
  not published independently.
- **Order snapshot — TC-PRICE-PREFILL-03**: place an order from the cached signed list and
  verify `order_items`, `orders.delivery_fee_zar`, and `orders.total_zar` preserve the values
  actually agreed at placement. Later changes to a Runner's list must not rewrite that order
  (ADR-0004).
- **No schema floors — TC-PRICE-PREFILL-04**: confirm neither the R15/R20 suggestions nor
  any price-floor/default column, extra client table, or Admin price control is introduced.

### 2.7 Requirements Traceability Matrix (Sample)

| Req ID | Requirement | Test Cases | Status |
|--------|-------------|------------|--------|
| REQ-ANON-01 | All network traffic must route through Tor | TC-TOR-01 to TC-TOR-08 | Pending |
| REQ-ANON-02 | No clearnet fallback if Tor fails | TC-TOR-09, TC-TOR-10 | Pending |
| REQ-PAY-01 | Generate unique Monero subaddress per order | TC-PAY-01 to TC-PAY-05 | Pending |
| REQ-PAY-02 | Detect payment within 3 blocks | TC-PAY-06, TC-PAY-07 | Pending |
| REQ-PROOF-01 | Photo must be hardware-signed | TC-PROOF-01 to TC-PROOF-04 | Pending |
| REQ-PROOF-02 | Location proof must be ZK-verifiable by the existing verifier; coarse-geohash mode is explicitly non-ZK | TC-PROOF-05 to TC-PROOF-08; TC-ZK-BE-01 | Pending |
| REQ-PROOF-03 | Optional Mopro/GPU and CPU backends preserve one proof contract and fallback safely to Zakura/CPU, lower-precision CPU, then coarse geohash (ADR-0030) | TC-ZK-BE-01 to TC-ZK-BE-05 | Pending |
| REQ-CAT-01 | Both apps use the same fixed eight-item catalog, including Grape Soda; no price is stored in the catalog reference | TC-CAT-01 | Pending |
| REQ-PRICE-01 | Runner-signed price lists are cached and the actual chosen values are frozen into each order snapshot (ADR-0004) | TC-PRICE-PREFILL-02 to TC-PRICE-PREFILL-03 | Pending |
| REQ-PRICE-02 | R15.00 Grape Soda and R20.00 delivery fee are editable prefill suggestions, not required prices or minimums | TC-PRICE-PREFILL-01 to TC-PRICE-PREFILL-04 | Pending |
| REQ-DB-01 | All local data encrypted with SQLCipher | TC-DB-01 to TC-DB-05 | Pending |
| REQ-DB-02 | Monero wallet secrets never stored in SQLCipher DB | TC-DB-06 | Pending |
| REQ-SEC-MEM-01 | Customer and Runner wallet secrets and the view-key PIN never cross the JavaScript/JSI boundary | TC-SEC-MEM-01 to TC-SEC-MEM-04 | Pending |
| REQ-SEC-MEM-02 | Native wallet-secret buffers are locked where supported and zeroized on every exit path | TC-SEC-MEM-05 to TC-SEC-MEM-08 | Pending |
| REQ-SEC-MEM-03 | Optional private view-key PIN/HKDF handling stays native; neither PIN nor key enters JavaScript; seed/spend keys stay biometric-only | TC-SEC-MEM-09 to TC-SEC-MEM-11 | Pending |
| REQ-SEC-WIPE-01 | Only verified managed Android app installations may receive a valid, target-bound, signed, unexpired app-data wipe command | TC-SEC-WIPE-01 to TC-SEC-WIPE-03 | Pending |
| REQ-SEC-WIPE-02 | Native wipe erases DAMZ app-scoped keys, database, sidecars, and caches without exposing wallet secrets to JavaScript | TC-SEC-WIPE-04 | Pending |
| REQ-SEC-WIPE-03 | Wipe is best-effort app-data deletion only; no iOS/unmanaged support, device reset, or false completion claim | TC-SEC-WIPE-05 to TC-SEC-WIPE-06 | Pending |
| REQ-WALLET-01 | Both apps support native-only backup/recovery of the full 25-word Monero mnemonic | TC-WALLET-01 to TC-WALLET-04 | Pending |
| REQ-MSG-01 | Messages E2EE with Signal Protocol | TC-MSG-01 to TC-MSG-06 | Pending |

### 2.8 CI/CD Integration

Testing must be automated and integrated into the CI/CD pipeline. The recommended pipeline stages:

```
Stage 1: Lint + Type Check     (eslint, tsc)
Stage 2: Unit Tests            (jest --coverage)
Stage 3: Integration Tests     (jest --testPathPattern=integration)
Stage 4: Contract Tests        (OpenAPI validation, Relay schema, libsignal vectors)
Stage 5: Security Scan         (narvy scan --output sarif)
Stage 6: Build APK/IPA         (expo prebuild + gradle/xcodebuild)
Stage 7: E2E Tests             (maestro test flows/)
Stage 8: Coverage Gate         (fail if < 70% on core modules)
```

**Critical**: The security scan (Stage 5) must fail the pipeline if any hardcoded secrets, weak crypto, or insecure configuration is found. This is non-negotiable for an anonymity-focused app.


## Summary of Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Local DB engine | WatermelonDB + SQLCipher | Reactive, offline-first, AES-256 encryption |
| Key storage | Platform Keychain/Keystore; Expo for non-wallet keys; native `SecureMemory` for Monero wallet secrets | Hardware-backed at rest; wallet-secret plaintext never enters JavaScript |
| Blob storage | Meshkit S3 → Helia (v2) | Client-side AES-GCM, no daemon needed |
| OrbitDB | **Not used** | Inventory management removed; RN support immature |
| E2E framework | Maestro (v1) → Detox (fallback) | Lowest setup, YAML-based, cross-platform |
| Security standard | OWASP MASVS | Industry standard, 8 categories, 24 controls |
| SAST tool | `narvy-cli` | Local, no account, high-signal findings |
| Methodology | V-Model + STLC | Early test planning, security at every level |
| Contract testing | OpenAPI + Relay schema + libsignal vectors | Client/server compatibility |
| Wallet UX | Independent Customer/Runner wallets; native-only 25-word mnemonic and wallet secrets; biometric-only seed/spend access; optional private-view-key PIN-HKDF exception remains native | No central wallet; wallet secrets never enter JavaScript |
| Push notifications | UnifiedPush (self-hosted) | No Google/Apple, works over Tor |
| Distribution | F-Droid + GrapheneOS/CalyxOS | No Play Store, reproducible builds |
| Converter | Integrated tab, UnstoppableSwap BTC↔XMR | In-app atomic swaps for BTC holders |
| Dispute resolution | Asymmetric (customer raises, admin judges) | No runner evidence, 14-day timeout |