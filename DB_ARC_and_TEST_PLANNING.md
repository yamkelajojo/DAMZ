# DAMZ — Database Architecture & Testing Specification

**Document**: DB-ARCH-001 & TEST-001
**Project**: DAMZ
**Version**: 1.0
**Status**: Draft for Review


## Part I: Database Architecture

### 1.1 Design Principles

The database architecture for DAMZ must satisfy four non-negotiable constraints derived from the threat model:

1. **Zero Plaintext at Rest** — Every byte of user data (DIDs, order records, chat history, wallet seeds, proof bundles) must be encrypted on device before it touches any storage layer.

2. **No Central Database Server** — There is no PostgreSQL, MySQL, or MongoDB instance that holds user data. The "database" is a combination of encrypted local storage and content-addressed decentralized storage (IPFS).

3. **Offline-First** — Runners operate in areas with intermittent connectivity. Every operation must succeed locally and sync when connectivity is restored.

4. **Ephemeral Where Possible** — Order chats, delivery proofs, and payment records have a defined lifecycle. Once the delivery is confirmed and the customer has retrieved the proof, the data should be eliminable.

### 1.2 Storage Layers

DAMZ uses a **three-tier storage architecture**:

| Tier | Technology | Purpose | Encryption |
|------|-----------|---------|------------|
| **Tier 1: Local Encrypted DB** | WatermelonDBCipher (SQLCipher fork) | Structured data: orders, DIDs, wallet metadata, session state | AES-256 (SQLCipher) |
| **Tier 2: Secure Key Store** | `expo-secure-store` / React Native Keychain | Encryption keys, wallet seeds, biometric-protected secrets | Hardware-backed (Keychain/Keystore) |
| **Tier 3: Decentralized Blob Store** | IPFS (Helia or Meshkit S3 backend) | Encrypted proof bundles: delivery photos, ZK location proofs, signed attestations | AES-256-GCM (client-side, before upload) |

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

-- Wallet metadata (NOT the seed — seed is in Tier 2)
CREATE TABLE wallet_metadata (
  id INTEGER PRIMARY KEY CHECK(id = 1),  -- Singleton row
  primary_address TEXT NOT NULL,
  view_key_encrypted BLOB,       -- Encrypted view key (optional)
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

`expo-secure-store` provides access to the iOS Keychain and Android Keystore/SharedPreferences with encryption. This is where the most sensitive data lives:

- **SQLCipher database key** — The key that unlocks Tier 1.
- **Monero wallet seed** — The 25-word mnemonic. Never stored in the SQLCipher database, only in the Keychain/Keystore.
- **DID private keys** — The Ed25519 keys for the user's DID.
- **Signal Protocol identity keys** — The long-term identity key pair.

**Hardware-backed protection:**

On iOS, Keychain items with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` are stored in the Secure Enclave and cannot be extracted even with root access. On Android, `expo-secure-store` uses the Android Keystore system, which can use StrongBox (dedicated security chip) on Pixel devices and Samsung Knox devices.

```typescript
// Store Monero seed (never in SQLCipher DB)
await SecureStore.setItemAsync('damz_monero_seed', mnemonic, {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true, // Face ID / fingerprint
  authenticationPrompt: 'Authenticate to access your Monero wallet',
});
```

#### Tier 3: Decentralized Blob Store (IPFS)

Delivery proof bundles (encrypted photo + ZK location proof + hardware signature) are stored on IPFS. The encryption happens **on the device before upload** using AES-256-GCM. The IPFS node or S3-compatible backend only ever sees ciphertext.

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
| Monero seed | Tier 2 only | App lifetime | User-initiated wipe |
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

**Critical distinction**: The Monero wallet seed must never be stored in the SQLCipher database. It lives only in `expo-secure-store` (iOS Keychain / Android Keystore). The SQLCipher database stores only **wallet metadata**: primary address, account index, restore height, last sync height.

**View key handling**: The private view key is optional to store. If stored, it is encrypted with a key derived from the user's biometric/PIN via HKDF and placed in `expo-secure-store`. The app can function without storing the view key if it relies on the Monero gateway for balance and transaction detection.

**Reference implementations:**

- **Monerujo** (Android): Stores wallet files in app-internal storage accessible only by the app on non-rooted devices. Wallet data is encrypted with the wallet password using the Monero encryption scheme.
- **MyMonero**: Android data is encrypted and saved using AndroidKeyStore and SharedPreferences. iOS uses SwiftKeychainWrapper. All secret data is encrypted with AES-256 symmetric key directly on the device.

DAMZ follows MyMonero's pattern: seed in Keychain/Keystore, metadata in SQLCipher.

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
│                    │ expo-secure- │  (iOS Keychain / Android         │
│                    │ store        │   Keystore, biometric-gated)     │
│                    └──────┬───────┘                                  │
│                           │                                         │
│  ┌────────────────────────┼────────────────────────┐                │
│  │                        │                        │                │
│  ▼                        ▼                        ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ SQLCipher    │  │ Monero seed  │  │ DID private keys         │  │
│  │ DB key       │  │ (25 words)   │  │ Signal identity keys     │  │
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
| Secure key store | `expo-secure-store` | 14+ | `docs.expo.dev/versions/latest/sdk/securestore` |
| Encryption (AES-256-GCM) | `@ipfs-meshkit/meshkit` | 1.2+ | `github.com/IPFS-Meshkit/meshkit0` |
| IPFS (v2) | Helia | 5+ | `helia.io` |
| Monero crypto | `react-native-mymonero-core` | 0.4+ | `github.com/EdgeApp/react-native-mymonero-core` |
| Signal Protocol | `expo-libsignal` | 0.2+ | `npmjs.com/package/expo-libsignal` |


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
- **Biometric authentication**: Secure store access is gated by Face ID / fingerprint.
- **Offline behavior**: Runner app works without network, syncs when connectivity is restored.
- **Data purge**: Orders older than 90 days are automatically deleted.

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

### 2.7 Requirements Traceability Matrix (Sample)

| Req ID | Requirement | Test Cases | Status |
|--------|-------------|------------|--------|
| REQ-ANON-01 | All network traffic must route through Tor | TC-TOR-01 to TC-TOR-08 | Pending |
| REQ-ANON-02 | No clearnet fallback if Tor fails | TC-TOR-09, TC-TOR-10 | Pending |
| REQ-PAY-01 | Generate unique Monero subaddress per order | TC-PAY-01 to TC-PAY-05 | Pending |
| REQ-PAY-02 | Detect payment within 3 blocks | TC-PAY-06, TC-PAY-07 | Pending |
| REQ-PROOF-01 | Photo must be hardware-signed | TC-PROOF-01 to TC-PROOF-04 | Pending |
| REQ-PROOF-02 | Location proof must be ZK-verifiable | TC-PROOF-05 to TC-PROOF-08 | Pending |
| REQ-DB-01 | All local data encrypted with SQLCipher | TC-DB-01 to TC-DB-05 | Pending |
| REQ-DB-02 | Seed never stored in SQLCipher DB | TC-DB-06 | Pending |
| REQ-MSG-01 | Messages E2EE with Signal Protocol | TC-MSG-01 to TC-MSG-06 | Pending |

### 2.8 CI/CD Integration

Testing must be automated and integrated into the CI/CD pipeline. The recommended pipeline stages:

```
Stage 1: Lint + Type Check     (eslint, tsc)
Stage 2: Unit Tests            (jest --coverage)
Stage 3: Integration Tests     (jest --testPathPattern=integration)
Stage 4: Security Scan         (narvy scan --output sarif)
Stage 5: Build APK/IPA         (expo prebuild + gradle/xcodebuild)
Stage 6: E2E Tests             (maestro test flows/)
Stage 7: Coverage Gate         (fail if < 70% on core modules)
```

**Critical**: The security scan (Stage 4) must fail the pipeline if any hardcoded secrets, weak crypto, or insecure configuration is found. This is non-negotiable for an anonymity-focused app.


## Summary of Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Local DB engine | WatermelonDB + SQLCipher | Reactive, offline-first, AES-256 encryption |
| Key storage | `expo-secure-store` | Hardware-backed, biometric-gated |
| Blob storage | Meshkit S3 → Helia (v2) | Client-side AES-GCM, no daemon needed |
| OrbitDB | **Not used** | Inventory management removed; RN support immature |
| E2E framework | Maestro (v1) → Detox (fallback) | Lowest setup, YAML-based, cross-platform |
| Security standard | OWASP MASVS | Industry standard, 8 categories, 24 controls |
| SAST tool | `narvy-cli` | Local, no account, high-signal findings |
| Methodology | V-Model + STLC | Early test planning, security at every level |