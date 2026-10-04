# DAMZ — Technical Specification v1.0

**Project**: DAMZ — Anonymous Medicine & Herb Delivery Platform
**Target Market**: South Africa (ZAR ↔ XMR)
**Architecture**: React Native (Expo) + Tor + Monero + Signal Protocol + ZK Location Proofs
**License**: AGPL-3.0 (recommended for network-service copyleft)

---

## 0. Repository Decision: Fork vs. Fresh

**Recommendation: Fresh repository. Do not fork Checkstar.**

Reasoning:

1. **Checkstar is not publicly accessible.** The URL returns an error, meaning either the repo is private, renamed, or deleted. You cannot fork what you cannot access.

2. **DAMZ is architecturally different at every layer.** Checkstar uses Stripe-style payments, email-based auth, and a centralized server. DAMZ replaces every one of those: Monero subaddresses replace Stripe, DIDs replace email, Tor onion services replace centralized servers, and Signal Protocol replaces standard chat. Forking would leave you deleting more than you keep.

3. **The integration surface is too different.** Checkstar's data models (orders, products, carts) assume a conventional e-commerce backend. DAMZ's data models assume no server, no accounts, and ephemeral order state. The overlap is maybe 15% — the UI shell.

4. **What to borrow from Checkstar**: If you have access to the source locally, extract only the **UI component patterns** (product cards, order list views, navigation structure) and **utility functions** (currency formatting, date handling). Copy these into the fresh repo as reference. Do not copy the architecture.

**Recommended repo structure**:

```
damz/
├── apps/
│   ├── customer/          # Customer-facing app
│   ├── runner/            # Runner/salesman app
│   └── converter/         # ZAR ↔ XMR converter
├── packages/
│   ├── core/              # Shared: crypto, DID, Tor, Monero
│   ├── ui/                # Shared UI components
│   └── types/             # Shared TypeScript types
├── services/
│   ├── monero-gateway/    # MoneroPay wrapper (.onion)
│   ├── relay/             # Cwtch-style discardable relay
│   └── ipfs-pinner/       # Self-hosted IPFS pinning (.onion)
├── docs/
│   ├── SPEC.md            # This document
│   ├── THREAT-MODEL.md
│   └── ARCHITECTURE.md
└── scripts/
    ├── mkp224o/           # Onion vanity address generation
    └── monero-stagenet/   # Local testnet setup
```

---

## 1. Threat Model

**Adversary**: Network-level surveillance (ISP, state), platform-level surveillance (Google Play Services, app stores), server compromise (relay, gateway, pinner), physical device seizure.

**Assumptions**:
- The adversary can observe all network traffic to and from the device.
- The adversary cannot break AES-256-GCM, X25519, Ed25519, or zk-SNARK soundness.
- The adversary may operate malicious relay nodes.
- The adversary does not have physical access to the device during operation.

**Out of scope**:
- Compromised operating system (rooted/jailbroken device).
- Hardware key extraction from Secure Enclave/StrongBox.
- Rubber-hose cryptanalysis.

---

## 2. Network Layer: Tor

### 2.1 Tor Daemon in React Native

**Library**: `react-native-nitro-tor`
**Source**: https://github.com/smolcars/react-native-nitro-tor
**Version**: 0.6.0 (latest as of research)
**License**: MIT

This library runs a Tor daemon directly inside the React Native application using pure C++ TurboModules (Craby). It creates and manages Tor hidden services and makes HTTP requests over the Tor network.

**Installation**:

```bash
npm install react-native-nitro-tor
```

**Starting Tor with a hidden service**:

```typescript
import { RnTor } from 'react-native-nitro-tor';

const startTor = async () => {
  const result = await RnTor.startTorIfNotRunning({
    data_dir: '/path/to/tor/data',
    socks_port: 9050,
    target_port: 8080,
    timeout_ms: 60000,
  });

  if (result.is_success) {
    console.log(`Onion address: ${result.onion_address}`);
    console.log(`Control: ${result.control}`);
  }
};
```

**HTTP over Tor**:

```typescript
const makeGetRequest = async () => {
  const result = await RnTor.httpGet({
    url: 'http://example.onion',
    headers: '',
    timeout_ms: 2000,
  });
  console.log(`Status: ${result.status_code}`);
  console.log(`Body: ${result.body}`);
};
```

**Platform support**: iOS, macOS, Android (arm64-v8a, x86_64, x86, armeabi-v7a).

### 2.2 Onion Service Generation

**Tool**: `mkp224o`
**Source**: https://github.com/cathugger/mkp224o

Generates vanity ed25519 (hidden service version 3) onion addresses. Use this to generate memorable `.onion` addresses for your relay, gateway, and pinner services.

```bash
./mkp224o -d onions damz
```

**Integration note**: The onion address is generated server-side (on your relay/gateway host), not in the mobile app. The app connects to a hardcoded or dynamically-discovered onion address.

### 2.3 I2P as Secondary Transport (Optional)

I2P provides garlic routing and unidirectional tunnels, offering stronger resistance to traffic correlation than Tor's circuit-based approach. For DAMZ, I2P can serve as a fallback transport when Tor is blocked.

**Note**: There is no mature React Native I2P library. I2P integration would require a native module wrapping the I2P router (i2pd or Java I2P). This is a v2 feature, not v1.

---

## 3. Messaging Layer: Signal Protocol + Metadata-Resistant Relay

### 3.1 Signal Protocol (Content Encryption)

**Library**: `react-native-libsignal-client`
**Source**: https://github.com/p-num/react-native-libsignal-client
**Version**: 0.5.0 (latest as of research)

This wraps the official `libsignal` Rust core (used by Signal, WhatsApp, etc.) via Swift/Java/Kotlin bindings. It provides X3DH, Double Ratchet, Kyber PQ, Sender Keys, and Sealed Sender. You must provide your own SQLCipher-backed store implementation.

**Requirements**: React Native 0.83+, Android 7+ (SDK 36), iOS 15.1+. New architecture required.

**Installation**:

```bash
bun add react-native-libsignal-client
```

Also install `expo-sqlite` and `expo-secure-store` for the store.

No Expo plugin — you must run `npx pod-install` and configure native modules manually.

**Signal Protocol Store**: TypeScript implementation over `expo-sqlite` (SQLCipher) + `expo-secure-store` (ADR-0021). Implements full `SignalProtocolStore` interface: prekeys, sessions, sender keys, identity keys. Long-term identity keys in Secure Store, ephemeral keys in SQLCipher DB.

### 3.4 UnifiedPush Notifications (ADR-0031)

**Implementation**: Self-hosted UnifiedPush distributor (no Google/Apple dependency). Works over Tor. Encrypted payload via Signal session. Apps register via Tor on first launch. Push payload = encrypted Signal message. Battery efficient.

**Usage pattern**:

```typescript
// Assumes you copied example/src/client/SignalClient.ts to ./client/SignalClient.ts
import { SignalClient } from './client/SignalClient';

const alice = await SignalClient.open({
  databaseName: 'alice.db',
  keyAlias: 'alice.dbkey',
  self: { name: 'alice-uuid', deviceId: 1 },
});
await alice.initializeIfNeeded({ registrationId: 12345 });

// Bob publishes a one-time prekey bundle
const bobsBundle = await bob.publishOneTimePreKey({
  preKeyId: 100,
  signedPreKeyId: 200,
  kyberPreKeyId: 300,
});

// Alice starts a session
await alice.startSession({ name: 'bob-uuid', deviceId: 1 }, bobsBundle);

// Alice encrypts
const envelope = await alice.send({ name: 'bob-uuid', deviceId: 1 }, 'hello');

// Bob decrypts
const received = await bob.receive(envelope);
console.log(received.plaintext); // 'hello'
```

**Alternative (rejected for v1)**: `expo-libsignal` (https://www.npmjs.com/package/expo-libsignal) — Expo-native wrapper with built-in SQLCipher store and Sealed Sender. Chose `react-native-libsignal-client` for cryptographic maturity (official libsignal Rust core) and to avoid Expo plugin lock-in.

### 3.2 Metadata-Resistant Relay (Cwtch-Inspired)

**Concept**: Cwtch is a privacy-preserving, multi-party messaging protocol designed such that no information is exchanged or available to anyone without their explicit consent, including on-the-wire messages and protocol metadata. It extends the metadata-resistant protocol Ricochet to support asynchronous, multi-peer group communications through the use of **discardable, untrusted, anonymous infrastructure**.

**DAMZ implementation**: We do not use Cwtch directly (no React Native SDK). Instead, we implement a minimal discardable relay in Rust or Go that:

1. Accepts encrypted blobs from Tor onion services.
2. Stores them in memory only (no disk persistence).
3. Forwards them to the recipient's onion service when reachable.
4. Has no logs, no analytics, no persistent state.
5. Is designed to be replaced — multiple community-run relays, any one can serve any message.

**Protocol sketch**:

```
RELAY_PROTOCOL:
  PUT /blob/{recipient_onion_hash}
    Body: encrypted_blob (opaque bytes)
    Headers: X-Expiry (seconds)
    Response: 202 Accepted, {blob_id}

  GET /blob/{blob_id}
    Response: 200 OK, encrypted_blob
    (Blob is deleted after retrieval or expiry)
```

The relay never sees plaintext. The recipient onion hash is a hash of the recipient's Tor public key — the relay cannot map it to an identity.

### 3.3 SimpleX Unidirectional Queue Model (For Order Chats)

**Source**: https://github.com/simplex-chat/simplexmq

SimpleX uses **unidirectional (simplex) messaging queues**, with a separate set of queues for each contact. Participants do not need globally unique addresses. The SMP protocol has only 10 client commands and 8 server responses — it is intentionally minimal.

**DAMZ adaptation**: For each order, the customer and runner establish two unidirectional queues:

- **Queue A**: Customer → Runner (order updates, delivery confirmation request)
- **Queue B**: Runner → Customer (delivery proof, location lock hash, completion)

These queues are hosted on different discardable relays. There is no shared identifier between Queue A and Queue B. The relay hosting Queue A knows only that "someone is sending messages to this queue." It does not know who the runner is, where they are, or what the messages contain.

**Implementation**: This requires porting the SMP agent protocol to React Native. The `simplexmq` codebase is Haskell, so this is non-trivial. **Alternative for v1**: Use the Signal Protocol for content E2EE and the Cwtch-style relay for transport. The unidirectional queue model is a v2 refinement.

---

## 4. Identity Layer: DIDs, No Email, No Phone

### 4.1 Decentralized Identifiers (DIDs)

**Library**: `@credebl/ssi-mobile`
**Source**: https://github.com/credebl/mobile-sdk
**Docs**: https://docs.credebl.id/docs/getting-started/local-deployment/mobile-sdk

This is a React Native SDK for adding Self-Sovereign Identity (SSI) capabilities to your app. Users hold, present, and exchange verifiable digital credentials without relying on a central authority. It handles wallet initialization, DID operations, credential storage, key management, and DIDComm protocol support.

**Installation**:

```bash
npm install @credebl/ssi-mobile
```

**Peer dependencies**:

```json
{
  "dependencies": {
    "@hyperledger/anoncreds-react-native": "^0.1.0",
    "@hyperledger/aries-askar-react-native": "^0.1.1",
    "@hyperledger/indy-vdr-react-native": "^0.1.0"
  }
}
```

**Initialization**:

```typescript
import { initializeAgent, getAgentModules } from '@credebl/ssi-mobile';

const config: InitConfig = {
  label: 'DAMZ Wallet',
  walletConfig: {
    id: 'damz-wallet',
    key: 'damz-wallet-key',
  },
  logger: new ConsoleLogger(LogLevel.debug),
  autoUpdateStorageOnStartup: true,
};

const agent = await initializeAgent({
  agentConfig: config,
  modules: getAgentModules(mediatorUrl, indyLedgers),
});
```

**Identity model**: Each user generates a DID on first launch. No email, no phone number. The DID is stored locally in the encrypted wallet. The runner's DID is shared with customers via the order flow. The customer's DID is shared with the runner only for the duration of the order.

### 4.2 Anonymous Email (Onboarding Only)

**Tool**: LNemail
**Source**: https://github.com/lnemail/lnemail

LNemail provides fast anonymous email accounts powered by Bitcoin Lightning Network payments. No personal information is required — just pay with Bitcoin Lightning and start sending and receiving emails immediately.

**API**:

```
POST https://lnemail.net/api/v1/email
→ Returns Lightning invoice + payment hash

GET https://lnemail.net/api/v1/payment/{payment_hash}
→ Returns payment status and account details if paid

GET https://lnemail.net/api/v1/emails
→ Requires access token, returns email headers

POST https://lnemail.net/api/v1/email/send
→ Sends email, returns Lightning invoice for payment
```

**DAMZ usage**: LNemail is used **only for optional order receipts** if the user wants an email copy. The email address is disposable, paid for with Lightning, and linked to nothing else. The app functions fully without an email address. This is a convenience feature, not a requirement.

### 4.3 Alternative: Alphanumeric IDs (BChat-Style)

If DID infrastructure proves too heavy for v1, fall back to BChat's model: generate a random alphanumeric code at signup that acts as the user ID. No phone, no email, no real-world identity. This is lighter than DIDs but provides less verifiability for runner credentials.

---

## 5. Payment Layer: Monero

### 5.1 Monero Crypto Primitives (Client-Side)

**Library**: `react-native-mymonero-core`
**Source**: https://github.com/EdgeApp/react-native-mymonero-core
**Version**: 0.4.0

This library packages Monero C++ crypto methods for use on React Native. It has a single default export that mostly matches the `WABridge` interface from `@mymonero/mymonero-monero-client`. All methods are async.

**Available methods**: `addressAndKeysFromSeed`, `compareMnemonics`, `createTransaction`, `decodeAddress`, `estimateTxFee`, `generateKeyImage`, `generatePaymentId`, `generateWallet`, `isIntegratedAddress`, `isSubaddress`, `isValidKeys`, `mnemonicFromSeed`, `newIntegratedAddress`, `seedAndKeysFromMnemonic`.

**Installation**:

```bash
npm install react-native-mymonero-core
npx pod-install
```

**Usage**:

```typescript
import bridge from 'react-native-mymonero-core';

const addressInfo = await bridge.decodeAddress(
  '84WsptnLmjTYQjm52SMkhQWsepprkcchNguxdyLkURTSW1WLo3tShTnCRvepijbc2X8GAKPGxJK9hfQhLHzoKSxh7y8Yqrg',
  'MAINNET'
);
```

**Building from source**: The library relies on native C++ code from third-party repos. You must run `npm run update-sources` before publishing. This script downloads third-party source code, sets up the Android build system, compiles an iOS universal static library, and generates Flow types.

**Requirements**: Recent Android SDK, Xcode command-line tools, `llvm-objcopy` (via `brew install llvm`).

### 5.2 Payment Gateway (Server-Side, .onion)

**Tool**: Custom Rust gateway using `acceptxmr` library (ADR-0009)
**Source**: https://github.com/busyboredom/acceptxmr

Build a custom Monero payment gateway in Rust using the `acceptxmr` library, deployed as a .onion service. Do not use MoneroPay.

`acceptxmr` handles subaddress generation (from view key + primary address) and payment watching via monerod RPC. You build the HTTP API: `POST /receive` → returns subaddress + amount, `GET /receive/:address` → payment status, callback to relay on confirmation.

Runs on same VPS as admin service + relay, all Rust, single binary or small set of binaries. monerod runs alongside (separate process, RPC over localhost). View-only mode: gateway only needs view key + primary address; spend key stays offline.

### 5.3 Alternative: AcceptXMR (Rust Library)

**Source**: https://github.com/busyboredom/acceptxmr

AcceptXMR is a Rust library that generates subaddresses using your private view key and primary address. It watches for payments sent to that subaddress using a Monero daemon of your choosing, updating the UI in realtime and optionally performing a configurable callback once payment is confirmed.

This is a lighter-weight alternative to MoneroPay if you prefer to build the gateway in Rust. It does not include an HTTP API — you would build that around it.

### 5.4 ZAR ↔ XMR On-Ramp (Converter Feature — Integrated in Customer/Runner Apps)

**Customer App**: "Convert" tab for ZAR→XMR before ordering
- XmrBazaar / Haveno deep links for P2P exchange rates
- UnstoppableSwap (COMIT protocol) for BTC→XMR atomic swaps in-app
- No wallet, no swap execution — just rate display + deep links + atomic swap execution

**Runner App**: "Convert" tab for XMR→ZAR (cashing out earnings)
- Haveno for XMR→ZAR
- Direct to bank via P2P

**Shared**: `@damz/core` has `SwapManager` for UnstoppableSwap logic. Converter does not hold funds.

**XmrBazaar**: South African P2P Monero marketplace, no KYC, bank transfer/Instant EFT. Min R500, fees 10% up to R50k, 5% over. Direct payment, no middleman.

**Haveno DEX**: Open-source, Tor-routed, non-custodial P2P. 2-of-3 multisig.

**UnstoppableSwap**: Maker-taker BTC↔XMR atomic swaps via COMIT protocol. For BTC holders to convert without centralized exchange.

**Monero Stagenet** for all testing.

### 5.5 Monero Stagenet for Testing

**Source**: https://docs.getmonero.org

Monero's stagenet is a separate test network that mirrors mainnet behavior without real funds. Use it for all development and integration testing.

```bash
# Start a stagenet daemon
monerod --stagenet

# Start a stagenet wallet
monero-wallet-cli --stagenet

# In the wallet, start mining to get test funds
start_mining <yourwalletaddress> 1
```

MoneroPay has been tested against stagenet and regtest.

---

## 6. Location Locking + Photo Verification

### 6.1 Hardware-Backed Photo Signing

**Tool**: `@realreel/photo-attest`
**Source**: https://www.npmjs.com/package/@realreel/photo-attest

This is an Expo native module for hardware-bound C2PA capture signing. On iOS, it generates an ECDSA P-256 keypair in the Secure Enclave (private key never leaves the chip). On Android, the keypair lives in AndroidKeyStore using StrongBox when available, falling back to TEE otherwise. Device trust is established at enrollment via App Attest (iOS) or KeyStore Key Attestation (Android), and a fresh attestation token is embedded per upload.

**Build prerequisites**: iOS deployment target 16.0, Android `minSdkVersion` 28, JitPack Maven repository for `c2pa-android`.

**Alternative**: `react-native-biometric-signature`
**Source**: https://github.com/chamodanethra/react-native-biometric-signature

ECDSA P-256 in the iOS Secure Enclave or the Android Keystore (StrongBox-eligible on API 28+). Keys are generated inside the Secure Enclave and tied to the user's biometric set. This is lighter than `@realreel/photo-attest` but does not include the C2PA envelope.

**Vouch Protocol** also provides a React Native + Expo mobile app for media signing with capture-time signing, device-level attestation, and EXIF preservation. Source: https://github.com/vouch-protocol/vouch.

### 6.2 Zero-Knowledge Location Proofs

**Tool**: `@ajna-inc/poe-proofs`
**Source**: https://www.npmjs.com/package/@ajna-inc/poe-proofs
**Version**: 0.2.1

This npm package provides zero-knowledge proofs for time and location verification, POE Protocol compatible. It supports React Native with full proof generation using device sensors (GPS, magnetometer, barometer) and blockchain anchoring. Node.js supports verification using `snarkjs`.

**Installation**:

```bash
npm install @ajna-inc/poe-proofs
cd ios && pod install
```

**Generate a location proof**:

```typescript
import { generateLocationProofPOE } from '@ajna-inc/poe-proofs';

const locationProof = await generateLocationProofPOE({
  nonce: Date.now(),
  contextHash: 12345,
  sessionId: 67890,
  latitude: 37.7749,
  longitude: -122.4194,
  altitudeM: 10,
  gpsAccuracyM: 5,
  magXUt: 22.5,
  magYUt: 5.2,
  magZUt: 42.1,
  pressurePa: 101325,
  proofTimestamp: Math.floor(Date.now() / 1000),
  currentTimestamp: Math.floor(Date.now() / 1000),
  magneticTolerancePercent: 30,
  altitudeToleranceM: 50,
});

console.log(`Location proof valid: ${locationProof.isValid}`);
console.log(`Confidence: ${locationProof.confidenceScore}%`);
```

**Verify a location proof (Node.js)**:

```typescript
import { verifyLocationProofPOE } from '@ajna-inc/poe-proofs/node';

const isValid = await verifyLocationProofPOE(
  proofJson, // JSON string from mobile
  publicInputs, // Array of public input strings
  './location_proof.vkey.json' // Path to verification key
);
```

### 6.3 Academic Foundation: ZKLP

**Paper**: "Zero-Knowledge Location Privacy via Accurate Floating-Point SNARKs"
**Source**: https://eprint.iacr.org/2024/1842.pdf
**Authors**: Jens Ernstberger, Chengru Zhang, Luca Ciprian, Philipp Jovanovic, Sebastian Steinhorst (TU Munich, University of Hong Kong, UCL)

ZKLP enables users to prove to third parties that they are within a specified geographical region while not disclosing their exact location. It supports varying levels of granularity.

Key results:
- Proof generation: **0.26 seconds** on mobile hardware
- Verification: **~470 peers per second**
- Proof size: **~430 bytes** across all resolutions
- Uses IEEE 754-compliant floating-point zk-SNARK circuits
- 64 constraints per operation for 2¹⁵ single-precision floating-point multiplications

**DAMZ integration**: The runner's app uses `@ajna-inc/poe-proofs` (which implements the ZKLP paradigm) to generate a proof that their GPS coordinates fall within a geofenced radius of the delivery address. The customer's app verifies this proof without learning the runner's actual coordinates.

### 6.4 Zakura Common (Mobile ZK Acceleration)

**Source**: https://www.chaincatcher.com/en/article/2286547

Zakura Common is a set of cryptographic and protocol libraries for the Zcash ecosystem. Official benchmarks show:
- Mobile proof generation: **14x faster** (over 5x on desktop)
- Sinsemilla hash: **21x faster**
- zk-SNARK verification: **4–8x faster**
- Wallet transaction creation: **<200ms** (down from >3 seconds)

Open-sourced under MIT/Apache 2.0 dual license.

**Relevance**: Zakura's optimization techniques for mobile ZK proof generation are directly applicable to DAMZ's location proofs. If `@ajna-inc/poe-proofs` proves too slow on mid-range devices, Zakura Common's floating-point SNARK optimizations can be ported.

### 6.5 The Complete Location Lock Flow

1. **Capture**: Runner takes photo of the delivered goods at the delivery location.
2. **Sign**: `@realreel/photo-attest` signs the photo hash with a Secure Enclave/StrongBox-backed ECDSA P-256 key. The signature covers: photo hash + order ID + timestamp.
3. **Location proof**: `@ajna-inc/poe-proofs` generates a ZK proof that the runner's GPS coordinates are within X meters of the delivery address. The proof does not reveal the coordinates.
4. **Encrypt**: The signed photo + ZK proof bundle is encrypted with AES-256-GCM using a key derived from the order ID via HKDF.
5. **Store**: The encrypted bundle is uploaded to IPFS via `@ipfs-meshkit/meshkit` (S3 backend, no daemon). The CID is stored locally.
6. **Share**: The CID is sent to the customer via the Signal Protocol messaging layer.
7. **Verify**: Customer's app retrieves the bundle from IPFS, decrypts locally, verifies the ECDSA signature (device attestation), and verifies the ZK location proof. The customer learns only: "The runner was within X meters of the delivery point at time T."

---

## 7. Storage Layer: IPFS with Client-Side Encryption (Dual Backend — ADR-0010)

**Primary**: Meshkit S3 (MinIO behind Tor) — v1 default
**Opt-in**: Helia (full IPFS node in React Native) — feature flag

**Meshkit S3**:
- `@ipfs-meshkit/meshkit` with S3-compatible backend
- Client-side AES-256-GCM encryption before upload
- MinIO behind Tor (.onion)
- No IPFS daemon on mobile

**Helia** (v2, opt-in v1):
- Full IPFS in React Native (Helia v5 + custom storage adapter)
- libp2p over Tor via `arti`
- True decentralization, no S3 dependency

**Storage abstraction** in `packages/core/storage` with `StorageBackend` trait. Feature flag `useHelia` in settings. Both backends produce compatible CIDs for `proof_bundles` table.

---

## 8. Complete Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CUSTOMER DEVICE                               │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ DID Wallet   │  │ Signal Proto │  │ Monero Wallet            │  │
│  │ (credebl)    │  │ (expo-       │  │ (react-native-mymonero-  │  │
│  │              │  │  libsignal)  │  │  core)                   │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                        │                │
│         └─────────────────┼────────────────────────┘                │
│                           │                                         │
│                    ┌──────▼───────┐                                  │
│                    │ Tor Daemon   │                                  │
│                    │ (react-      │                                  │
│                    │  native-     │                                  │
│                    │  nitro-tor)  │                                  │
│                    └──────┬───────┘                                  │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            │ Tor Network (.onion)
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                    ┌──────▼───────┐                                  │
│                    │ Discardable  │                                  │
│                    │ Relay        │  (Cwtch-style, no logs)          │
│                    │ (.onion)     │                                  │
│                    └──────┬───────┘                                  │
│                           │                                         │
│  ┌────────────────────────┼────────────────────────┐                │
│  │                        │                        │                │
│  ▼                        ▼                        ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ MoneroPay    │  │ IPFS Pinner  │  │ Signal Protocol Relay    │  │
│  │ Gateway      │  │ (.onion)     │  │ (Sealed Sender routing)  │  │
│  │ (.onion)     │  │              │  │                          │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                        │                │
│         │                 │                        │                │
│         ▼                 ▼                        ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Monero Node  │  │ S3/IPFS      │  │ Encrypted Proof Bundles  │  │
│  │ (stagenet/   │  │ Storage      │  │ (AES-256-GCM)            │  │
│  │  mainnet)    │  │              │  │                          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                     │
│                        SERVER INFRASTRUCTURE                        │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ Tor Network (.onion)
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                    ┌──────▼───────┐                                  │
│                    │ Tor Daemon   │                                  │
│                    │ (react-      │                                  │
│                    │  native-     │                                  │
│                    │  nitro-tor)  │                                  │
│                    └──────┬───────┘                                  │
│                           │                                         │
│  ┌────────────────────────┼────────────────────────┐                │
│  │                        │                        │                │
│  ▼                        ▼                        ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ DID Wallet   │  │ Signal Proto │  │ Photo Attestation        │  │
│  │ (credebl)    │  │ (expo-       │  │ (@realreel/photo-attest) │  │
│  │              │  │  libsignal)  │  │                          │  │
│  └──────────────┘  └──────────────┘  └────────────┬─────────────┘  │
│                                                    │                │
│                                          ┌─────────▼─────────────┐  │
│                                          │ ZK Location Proof     │  │
│                                          │ (@ajna-inc/poe-proofs)│  │
│                                          └─────────┬─────────────┘  │
│                                                    │                │
│                                          ┌─────────▼─────────────┐  │
│                                          │ AES-256-GCM Encrypt   │  │
│                                          │ (@ipfs-meshkit/       │  │
│                                          │  meshkit)             │  │
│                                          └───────────────────────┘  │
│                                                                     │
│                         RUNNER DEVICE                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 9. Data Flow: Complete Order Lifecycle

### 9.1 Order Placement (Customer)

1. Customer opens app, selects items from the seven available (Cabbage, Spinach, Cinnamon, Cauliflower, Rock Salt, Flour, Bicarbonate of Soda).
2. Customer's app queries nearby runners via the relay (Tor onion service discovery). Runners advertise availability by publishing their onion service to a community-maintained IPNS record.
3. Customer selects a runner and places an order. Order details (items, quantities, delivery address geohash) are encrypted with the runner's Signal Protocol public key.
4. Customer's app generates a Monero subaddress request via the MoneroPay gateway (`.onion`). The gateway returns a subaddress + amount in XMR.
5. Customer sends XMR to the subaddress. MoneroPay detects the transaction and calls back to the relay.
6. Relay notifies runner via the runner's onion service. Runner's app decrypts the order details.

### 9.2 Order Fulfillment (Runner)

1. Runner confirms order acceptance. The runner's app establishes a Signal Protocol session with the customer (if not already established).
2. Runner procures the items (off-app — runner handles their own stock).
3. Runner arrives at delivery location. Takes photo of the goods at the location.
4. Runner's app generates a ZK location proof (coordinates within X meters of delivery address).
5. Runner's app signs the photo hash with Secure Enclave key.
6. Runner's app encrypts the proof bundle (photo + signature + ZK proof) with AES-256-GCM.
7. Runner's app uploads the encrypted bundle to IPFS via Meshkit. Receives CID.
8. Runner's app sends the CID to the customer via the Signal Protocol messaging layer.

### 9.3 Delivery Confirmation (Customer)

1. Customer's app receives the CID via the relay.
2. Customer's app retrieves the encrypted bundle from IPFS.
3. Customer's app decrypts the bundle locally with the order-derived key.
4. Customer's app verifies the ECDSA signature (device attestation — proves the photo was taken on a genuine device).
5. Customer's app verifies the ZK location proof (proves the runner was within X meters of the delivery address).
6. Customer confirms receipt. The Signal Protocol session is terminated. The relay's message queue for this order is deleted.

---

## 10. Build Configuration

### 10.1 package.json (Customer App)

```json
{
  "name": "damz-customer",
  "version": "1.0.0",
  "main": "expo-router/entry",
"scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "tailwind": "tailwindcss --watch --input ./global.css --output ./dist/tailwind.css"
  },
  "dependencies": {
      "expo": "~55.0.0",
      "react-native": "0.83.0",
      "react-native-nitro-tor": "^0.6.0",
      "react-native-libsignal-client": "^0.5.0",
      "expo-sqlite": "*",
      "expo-secure-store": "*",
      "react-native-mymonero-core": "^0.4.0",
      "@ipfs-meshkit/meshkit": "^1.2.1",
      "@ajna-inc/poe-proofs": "^0.2.1",
      "@did-tools/key": "^1.0.0",
      "@realreel/photo-attest": "^1.0.0",
      "nativewind": "^4.0.0",
      "react-native-reusables": "^0.1.0",
      "react-native-reanimated": "^3.10.0",
      "react-native-gesture-handler": "^2.16.0"
    }
}
```

### 10.2 app.json (Expo)

```json
{
  "expo": {
    "name": "DAMZ",
    "slug": "damz",
    "plugins": [
      "expo-sqlite",
      "expo-secure-store"
    ],
    "android": {
      "minSdkVersion": 28,
      "permissions": [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "CAMERA",
        "NFC",
        "FOREGROUND_SERVICE"
      ]
    },
    "ios": {
      "deploymentTarget": "16.0",
      "infoPlist": {
        "NSLocationWhenInUseUsageDescription": "DAMZ uses your location to verify delivery proximity.",
        "NSCameraUsageDescription": "DAMZ uses the camera to capture delivery proof photos.",
        "NSFaceIDUsageDescription": "DAMZ uses Face ID to protect your wallet and identity keys."
      }
    },
    "devDependencies": {
      "tailwindcss": "^3.4.0",
      "nativewind": "^4.0.0"
    }
  }
}
```

---

## 11. Development Roadmap (Parallel Tracks)

| Track | Phases | Deliverable | Dependencies |
|---|---|---|---|
| **A: Transport + Messaging** | P1 + P2 | Tor daemon + Signal Protocol chat (E2EE over `.onion`) | `react-native-nitro-tor`, `react-native-libsignal-client` |
| **B: Device Capabilities** | P3 + P4 + P5 | Monero payment (mock) + ZK location proof + Photo attestation | `react-native-mymonero-core`, `@ajna-inc/poe-proofs`, `@realreel/photo-attest` |
| **C: Storage + Identity** | P6 + P7 | IPFS storage (Meshkit S3 + Helia flag) + `did:key` identity | `@ipfs-meshkit/meshkit`, `helia`, custom `did:key` impl |
| **D: Server Infrastructure** | P9 | Discardable relay + AcceptXMR gateway + IPFS pinner (all `.onion`) | Rust, `axum`, `acceptxmr`, `minio`, `arti` |
| **Integration** | P8 | Wire all tracks into complete order lifecycle + converter tabs | Tracks A–D complete |
| **Production** | P10 | Mainnet deploy: stagenet → mainnet | Integration complete |

**Parallelization notes**: Tracks A, B, C are independent and can run concurrently. Track D starts when Track A has working Tor. Integration (P8) is the critical synchronization point — budget 40% of timeline.

---

## 12. Critical Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `react-native-nitro-tor` battery drain | High | Foreground service with persistent notification; allow user to toggle Tor when idle |
| ZK proof generation on low-end devices | Medium | Use `@ajna-inc/poe-proofs` with fallback to simpler location hash if proof fails |
| MoneroPay gateway downtime | High | Multiple gateway instances on different `.onion` addresses; app discovers via IPNS |
| Relay node compromise | Medium | Discardable relay design: no logs, no persistent state; multiple relays |
| LNemail service shutdown | Low | LNemail is optional; app functions without email |
| XmrBazaar/Haveno liquidity | Medium | Support both platforms; converter app displays rates from multiple sources |
| Google Play Store rejection | High | Distribute via F-Droid + direct APK + GrapheneOS app repository |

---

## 13. References

| Component | Source | URL |
|---|---|---|
| Tor RN | `react-native-nitro-tor` | https://github.com/smolcars/react-native-nitro-tor |
| Onion gen | `mkp224o` | https://github.com/cathugger/mkp224o |
| Signal Proto | `react-native-libsignal-client` | https://github.com/p-num/react-native-libsignal-client |
| Signal Proto (rejected) | `expo-libsignal` | https://www.npmjs.com/package/expo-libsignal |
| SimpleX | `simplexmq` | https://github.com/simplex-chat/simplexmq |
| Cwtch | Cwtch protocol | https://docs.cwtch.im |
| DID | `@did-tools/key` | https://github.com/did-tools/key |
| Anonymous email | LNemail | https://github.com/lnemail/lnemail |
| Monero RN | `react-native-mymonero-core` | https://github.com/EdgeApp/react-native-mymonero-core |
| Monero gateway | AcceptXMR | https://github.com/busyboredom/acceptxmr |
| ZAR P2P | XmrBazaar | https://xmrbazaar.com |
| DEX | Haveno | https://github.com/haveno-dex/haveno |
| Atomic swaps | UnstoppableSwap | https://unstoppableswap.net |
| Photo attest | `@realreel/photo-attest` | https://www.npmjs.com/package/@realreel/photo-attest |
| Photo attest (alt) | `react-native-biometric-signature` | https://github.com/chamodanethra/react-native-biometric-signature |
| Photo attest (alt) | Vouch Protocol | https://github.com/vouch-protocol/vouch |
| ZK location | `@ajna-inc/poe-proofs` | https://www.npmjs.com/package/@ajna-inc/poe-proofs |
| ZK location (paper) | ZKLP | https://eprint.iacr.org/2024/1842.pdf |
| ZK acceleration | Zakura Common | https://www.chaincatcher.com/en/article/2286547 |
| IPFS storage | `@ipfs-meshkit/meshkit` | https://github.com/IPFS-Meshkit/meshkit0 |
| IPFS RN | Helia | https://helia.io |
| Monero testnet | Stagenet | https://docs.getmonero.org |
| Push | UnifiedPush | https://unifiedpush.org |
| Privacy OS | GrapheneOS | https://grapheneos.org |
| Privacy OS | CalyxOS | https://calyxos.org |

---

## 14. Conclusion

DAMZ is technically feasible. Every component exists as working, auditable code. The integration surface is large but well-defined: Tor for transport, Signal Protocol for content encryption, DIDs for identity, Monero for payments, ZK proofs for location verification, and hardware-backed signing for photo authenticity.

The critical engineering challenges are:

1. **Making `react-native-nitro-tor` reliable on mobile** — battery, background execution, and connection resilience.
2. **Making ZK location proofs run on mid-range Android devices** — `@ajna-inc/poe-proofs` is the starting point, but Zakura Common's optimizations may need porting.
3. **Building the discardable relay** — a minimal Rust or Go service that runs behind Tor, stores nothing, and forwards encrypted blobs.
4. **Deploying and maintaining the `.onion` infrastructure** — MoneroPay gateway, IPFS pinner, relay nodes.

None of these are unsolvable. They are integration problems, not fundamental research problems. The cryptography is done. The protocols exist. The libraries are published. DAMZ is an assembly project.