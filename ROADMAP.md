# DAMZ — Implementation Roadmap

**Version**: 1.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

---

## Overview

12 phased, independently testable milestones. Each phase has a clear **Goal**, **Deliverables**, **Dependencies**, **Test Gate** (must pass to proceed), and **Risks/Unknowns**.

**Principle**: Vertical slices over horizontal layers. Test gate is non-negotiable — do not proceed if it fails.

---

## Phase 1: Schema Package + Validation + Tests

**Goal**: Complete, validated, tested database schema package published and consumable by apps.

**Deliverables**:
- `packages/db` with the full client-side WatermelonDB schema (all 19 tables, including the three documented converter tables)
- `validate-schema.ts` script passing
- `MIGRATION_STRATEGY.md` implemented (migration 0001_initial)
- `OWNERSHIP_CONTRACT.md` with TypeScript enforcement + unit tests
- Unit tests for all models, ownership enforcement, purge logic
- Published as `@damz/db@1.0.0`

**Dependencies**: None (foundation)

**Test Gate**:
- [ ] `bun run validate-schema` passes (0 errors)
- [ ] `bun test` in `packages/db` — 100% model coverage, ownership tests pass
- [ ] Migration 0001 applies cleanly to fresh DB
- [ ] Schema validation catches intentional violations (negative tests)

**Risks**:
- WatermelonDBCipher SQLCipher integration complexity
- TypeScript + SQLCipher + Hermes compatibility

---

## Phase 2: Customer App Skeleton + SQLCipher + Identity + Native Wallet

**Goal**: Customer app launches, initializes Tor, creates DID, encrypts DB, and provisions its independent local Monero wallet through native `SecureMemory`.

**Deliverables**:
- `apps/customer` Expo app with:
  - Tor daemon startup (ADR-0022)
  - SQLCipher DB initialization with `expo-secure-store` key
  - `did:key` generation via `@did-tools/key` (ADR-0018)
  - Native-only 25-word Monero mnemonic generation, backup, and recovery (ADR-0028; biometric-gated)
  - Managed-Android-only native app-data/key wipe handler (ADR-0029); no iOS or unmanaged-Android remote-wipe handler
  - Onboarding screen (1 of 13)
  - Settings screen (13 of 13) — theme, radius, Tor status, backup DID
- `packages/ui` primitives: Button, Input, Card, Sheet, Toast, ThemeProvider
- `packages/core` DIDManager, TorManager stubs

**Dependencies**: Phase 1 (`@damz/db`)

**Test Gate**:
- [ ] App cold starts <3s, shows onboarding
- [ ] DID generated, stored in DB, private key in Secure Store
- [ ] DB encrypted — verify file is unreadable without key
- [ ] Native-only 25-word backup/restore works (new-device simulation); no wallet secret or phrase crosses into JavaScript
- [ ] Biometric unlock gates native secure-store access for seed/spend-key operations
- [ ] Optional private view-key PIN-derived HKDF, if persisted, runs wholly in native code with no PIN/key crossing into JavaScript
- [ ] Native wipe-state test with a synthetic Admin-signed command on managed Android stops wallet work, zeroizes native buffers, removes app keys/SQLCipher DB and sidecars/caches, and does not reset the device; iOS/unmanaged Android reject or lack the feature (ADR-0029, OQ-SEC-WIPE-001/002)
- [ ] Tor starts, shows onion address in settings
- [ ] Unit tests: DIDManager, TorManager, DB init, native wipe state machine

**Risks**:
- `react-native-nitro-tor` stability on iOS/Android
- Native `SecureMemory` / Keychain/Keystore behavior and platform-specific memory-locking support (OQ-SEC-MEM-001/002)
- Android management-enrollment proof and native wipe interruption/sidecar handling (OQ-SEC-WIPE-001/002)
- Biometric behavior differences across supported devices
- Hermes + SQLCipher performance

---

## Phase 3: Runner App Skeleton + SQLCipher + Identity + Native Wallet

**Goal**: Runner app launches, creates DID + onion, claims pre-created registry entry.

**Deliverables**:
- `apps/runner` Expo app with:
  - Same Tor + SQLCipher + DID foundation as Customer
  - Onion service generation via `mkp224o` (dev) / Tor daemon (prod)
  - Runner onboarding: claim pre-created registry (ADR-0015)
  - Independent local Monero wallet using native `SecureMemory`; native-only 25-word mnemonic backup and recovery
  - Managed-Android-only native app-data/key wipe handler (ADR-0029); no iOS or unmanaged-Android remote-wipe handler
  - Dashboard screen (2 of 13)
  - Settings screen (13 of 13) — availability, radius, Tor, backup
- Shared `packages/core` identity logic

**Dependencies**: Phase 1, Phase 2 (shared foundation)

**Test Gate**:
- [ ] Runner generates onion address on first launch
- [ ] Claims registry entry via `/runners/claim` (mock admin)
- [ ] `identity.is_available` toggles correctly
- [ ] Runner wallet secrets remain in platform secure storage via native `SecureMemory`; no wallet secret or phrase crosses into JavaScript
- [ ] Native-only 25-word backup/recovery and biometric-gated seed/spend-key access work
- [ ] Optional private view-key PIN-derived HKDF, if persisted, runs wholly in native code with no PIN/key crossing into JavaScript
- [ ] Native wipe-state test with a synthetic Admin-signed command on managed Android verifies target/expiry/replay controls and removes Runner app keys/database/sidecars/caches without a device reset; iOS/unmanaged Android are excluded (ADR-0029, OQ-SEC-WIPE-001/002)
- [ ] Unit tests: Runner onboarding, native wallet boundary, and native wipe state machine

**Risks**:
- Onion service generation reliability (`mkp224o` vs in-app)
- Tor hidden service config in `react-native-nitro-tor`
- Android management-enrollment proof and native wipe interruption/sidecar handling (OQ-SEC-WIPE-001/002)

---

## Phase 4: Relay Service (Local Testnet) + Tor Transport

**Goal**: Two apps exchange encrypted blobs via local relay over Tor.

**Deliverables**:
- `services/relay` binary deployed locally (Docker)
- Local Tor network (Chutney or `arti` testnet)
- Apps connect to relay via `.onion` addresses
- PUT/GET blob flow working end-to-end
- Relay protocol contract tests (JSON Schema)

**Dependencies**: Phase 2, Phase 3 (apps have Tor + identity)

**Test Gate**:
- [ ] Customer PUT → Relay → Runner GET round-trip (<2s)
- [ ] Blob encryption verified (relay sees only ciphertext)
- [ ] TTL expiry works (blob deleted after retrieval/expiry)
- [ ] Multiple relays: round-robin failover works
- [ ] Relay restart survival (client retry with backoff)
- [ ] Contract tests pass in CI
- [ ] Load test: 100 concurrent PUT/GET

**Risks**:
- Local Tor testnet setup complexity
- `arti` vs system Tor compatibility
- Relay memory pressure under load

---

## Phase 5: Signal Protocol Integration + Per-Order Chat

**Goal**: Customer and Runner exchange E2EE messages via Signal Protocol over relay.

**Deliverables**:
- `SignalProtocolStore` implementation (ADR-0021) — prekeys, sessions, identity keys
- Session establishment (X3DH) between Customer ↔ Runner
- Per-order chat: two unidirectional queues (Customer→Runner, Runner→Customer)
- Message UI: list, send, receive, read receipts
- Offline queuing + retry (delivery_state, attempts)
- Envelope cleared after send; body stored decrypted (SQLCipher)

**Dependencies**: Phase 4 (transport works)

**Test Gate**:
- [ ] Two SignalClient instances establish session via mocked relay
- [ ] Encrypt → relay → decrypt round-trip (libsignal test vectors)
- [ ] Forward secrecy: new session after compromise
- [ ] Sealed Sender works (metadata resistance)
- [ ] Offline message queued, delivered on reconnect
- [ ] Message purge at 30 days works
- [ ] Integration test: full chat flow over local Tor + relay

**Risks**:
- `react-native-libsignal-client` native module linking
- SQLCipher store performance with many sessions
- Session corruption recovery

---

## Phase 6: Photo Attestation + ZK Location Proof

**Goal**: Runner captures hardware-signed photo + generates ZK location proof on device.

**Deliverables**:
- `@realreel/photo-attest` integration (ADR-0020):
  - Camera capture → C2PA signing (Secure Enclave / StrongBox)
  - Device attestation token (App Attest / KeyStore Attestation)
- Location-proof backend abstraction:
  - Optional Mopro/GPU prover when the exact DAMZ circuit/device combination passes the compatibility and parity gate (ADR-0030)
  - Zakura-optimized CPU prover remains the fallback; unmodified `@ajna-inc/poe-proofs` CPU remains the interim path if the Zakura port is not ready (ADR-0019)
  - Proof verification remains the existing customer-app + Admin CLI contract
- Final fallback: coarse geohash only (no ZK) if the CPU path—including ADR-0027's lower-precision retry for proving/verification failure—still fails or CPU proving exceeds five seconds
- Delivery Capture screen (8 of 13 runner)

**Dependencies**: Phase 1, 3 (runner app + core)

**Test Gate**:
- [ ] Photo captured, C2PA manifest verified on another device
- [ ] ZK proof generated <5s on mid-range Android (Pixel 6a class); benchmark Mopro/GPU and CPU paths on the actual DAMZ circuit rather than extrapolating package benchmarks (ADR-0030)
- [ ] Mopro/GPU and Zakura/CPU proofs use the same circuit/public-input contract and verify with the existing customer app + Admin CLI verifier
- [ ] Unsupported GPU, resource pressure, or GPU error falls back to Zakura CPU; if Zakura is unavailable use the unmodified `@ajna-inc/poe-proofs` CPU path
- [ ] CPU proving/verification failure retains the lower-precision CPU retry; coarse geohash activates only if that retry fails or CPU proving exceeds five seconds; no invalid GPU proof is accepted (ADR-0027)
- [ ] Proof verification passes (customer app + admin CLI)
- [ ] StrongBox detection works (Pixel/Samsung)
- [ ] Unit tests: PhotoAttestation, ZKProofManager
- [ ] Device attestation token embedded and verifiable

**Risks**:
- Mopro adapter/GPU compatibility with DAMZ's exact circuit, existing proof verifier, supported iOS/Android targets, and React Native bindings (OQ-ZK-PROVER-001/002)
- Zakura CPU port timeline (ADR-0019); the unmodified `@ajna-inc/poe-proofs` CPU path remains available if delayed
- Camera + GPS permission handling
- Battery, memory, and thermal throttling on both GPU and CPU proving paths

---

## Phase 7: Proof Bundle Encryption + IPFS Upload

**Goal**: Runner encrypts proof bundle, uploads to IPFS, sends CID + key to Customer.

**Deliverables**:
- AES-256-GCM encryption per bundle (random key)
- `MeshkitBackend` (default) + `HeliaBackend` (opt-in) (ADR-0010)
- IPFS upload → CID stored in `orders.proof_cid`
- Key sent over Signal chat → stored in `orders.proof_key`
- Proof Review screen (9 of 13) → Upload & Send Key (10 of 13)
- Customer: Proof Verification screen (10 of 13 customer)

**Dependencies**: Phase 5 (chat), Phase 6 (photo + ZK)

**Test Gate**:
- [ ] Bundle encrypted → uploaded → CID retrieved → decrypted → verified
- [ ] Meshkit S3 (MinIO .onion) works
- [ ] Helia opt-in works (feature flag)
- [ ] Key never leaves chat (verify via network capture)
- [ ] Proof bundle purge at 90 days
- [ ] Admin can decrypt when customer shares key
- [ ] Contract tests: CID format, encryption round-trip

**Risks**:
- MinIO behind Tor latency
- Helia React Native storage adapter stability
- IPFS pinning service TTL management

---

## Phase 8: Admin Service + Admin Dashboard (Local Testnet)

**Goal**: Admin service runs locally, manages runners, strikes, disputes, settings, and the narrowly scoped managed-Android app-data wipe queue; apps sync mirrors.

**Deliverables**:
- `services/admin` binary (Rust + Axum + SQLCipher + Arti)
- Admin CLI (runner add/ban, strike issue, dispute resolve, settings, wipe issue/list/cancel)
- Admin-only `wipe_pending` table (sixth Admin table; no client table or change to the 19-table schema) (ADR-0029)
- REST + SSE sync endpoints, including target-only wipe fetch/ack and `wipe.pending` wake-up (ADR-0016, ADR-0033, ADR-0029)
- Bounded-scope startup check (ADR-0041)
- DID-signed request auth
- Apps sync `strikes`, `directory`, `settings`, `disputes` mirrors
- Minimal admin dashboard (web, served by admin service or separate)

**Dependencies**: Phases 2–3 (Customer/Runner native wipe handlers), Phase 4 (relay for dispute notifications), and Phase 5 (Signal for proof key share)

**Test Gate**:
- [ ] Admin CLI: add runner → runner claims → appears in directory
- [ ] Admin issues strike → Customer mirror syncs within 30s
- [ ] Customer submits dispute → Admin sees in CLI
- [ ] Admin requests proof key → Customer shares → Admin decrypts proof
- [ ] Admin resolves dispute → Customer sees ruling
- [ ] SSE push works (strike.created, runner.banned, dispute.updated, wipe.pending); startup/resume polling also retrieves a pending wipe
- [ ] Managed Android wipe command is Admin-signed, target-DID/app-bound, single-use, expires within 72 hours, and only a verified enrolled device can fetch/ack it
- [ ] Customer and Runner managed-Android app-data wipe completes natively; iOS/unmanaged Android are excluded, and no factory reset occurs
- [ ] `accepted` is not reported as completion; `completed` is stored only after a successful native-handler receipt
- [ ] Bounded-scope check permits only the defined `wipe_pending` control fields while still rejecting all order/message/proof content
- [ ] Contract tests: OpenAPI spec, sync cursors, wipe command/ack

**Risks**:
- Rust `arti` Tor integration
- `sqlx` + SQLCipher compile-time checks
- SSE over Tor connection stability
- Android Enterprise/MDM enrollment proof, offline delivery, truthful app-reported completion, and finite encrypted-backup retention for terminal target DIDs (OQ-SEC-WIPE-001/002/003; OQ-003 before production)

---

## Phase 9: Monero Gateway (Stagenet) + Payment Flow

**Goal**: Real Monero payments via AcceptXMR gateway on stagenet.

**Deliverables**:
- `services/gateway` binary (AcceptXMR + monerod stagenet)
- `AcceptXmrPaymentProvider` implementing `PaymentProvider` interface
- Subaddress generation per order
- Payment detection → callback to relay → runner notification
- Payment screen (7 of 13 customer) — QR, countdown, status
- Wallet screen (12 of 13 runner) — balance, subaddresses, withdraw
- Customer send and Runner signing/transaction creation through native `SecureMemory`; JavaScript receives only non-secret results (ADR-0028)
- Fee preview, 5% platform fee extraction flow

**Dependencies**: Phase 5 (chat for payment notification), Phase 8 (relay callback)

**Test Gate**:
- [ ] Customer pays → gateway detects → runner notified (<30s)
- [ ] Subaddress unique per order (unlinkability test)
- [ ] Partial payment handling
- [ ] Expiry handling (15 min)
- [ ] Stagenet integration test: full payment flow
- [ ] Mock ↔ Real gateway swap via feature flag
- [ ] Contract tests: Monero test vectors, API schema

**Risks**:
- `acceptxmr` library maturity
- Monero node RPC stability
- Fee estimation accuracy
- Rate oracle reliability (XmrBazaar/Haveno API)

---

## Phase 10: Multi-Runner Discovery + Radius Matching

**Goal**: Customer discovers nearby runners, sees prices, places orders.

**Deliverables**:
- Runner publishes price list (signed) → Customer caches
- Customer Discover screen (2 of 13) — filter by radius, availability, fee
- Runner Profile screen (3 of 13) — cached price list
- Item Selection (4 of 13) — 8 items, prices, quantity, running total
- Address Entry (5 of 13) — geocoder, map picker, saved addresses
- Order Review (6 of 13) — items, prices, delivery fee, total ZAR, est. XMR
- Order placement → chat with address + order details

**Dependencies**: Phase 2, 3, 5 (chat), 7 (price list schema)

**Test Gate**:
- [ ] Runner publishes price list → Customer caches offline
- [ ] Customer places order → frozen price snapshot in `order_items`
- [ ] Order total never changes after placement
- [ ] Radius filtering works (coarse geohash)
- [ ] Multiple runners visible, selectable
- [ ] Offline order placement from cache

**Risks**:
- Geocoder accuracy (OpenStreetMap/Nominatim over Tor)
- Price list cache invalidation
- Order placement race conditions

---

## Phase 11: End-to-End Integration Test (Two Physical Devices, Tor)

**Goal**: Complete order lifecycle on real devices over real Tor network.

**Deliverables**:
- Two physical devices: Customer (GrapheneOS Pixel) + Runner (GrapheneOS Pixel)
- Real Tor network (not testnet)
- Real Monero stagenet
- Community relay instance (or local VPS)
- Admin service on VPS
- Full flow: Onboard → Discover → Order → Pay → Accept → Deliver → Verify → Purge

**Dependencies**: Phases 1–10 complete

**Test Gate**:
- [ ] **Full lifecycle succeeds** on real devices over real Tor
- [ ] Tor connectivity stable 24h+ (foreground service)
- [ ] Battery drain <15%/day with active orders
- [ ] All 13 customer screens + 13 runner screens functional
- [ ] Converter tab works (ZAR→XMR via XmrBazaar deep link)
- [ ] Dispute flow works end-to-end
- [ ] Data purge works (30d messages, 90d orders)
- [ ] Security scan (`narvy-cli`) passes on built APKs
- [ ] End-to-end managed-Android app-data wipe passes on enrolled test installations; verify only app-scoped keys/data are removed and offline targets are never reported as completed

**Risks**:
- Real Tor network latency/variance
- Device-specific issues (StrongBox, biometric, camera)
- Monero stagenet reliability
- Relay VPS uptime

---

## Phase 12: Mainnet Monero + Production Deployment

**Goal**: Production-ready apps deployed to F-Droid + GrapheneOS/CalyxOS repos.

**Deliverables**:
- Monero mainnet gateway + node
- Production relay(s) + admin service on VPS
- Reproducible builds (F-Droid requirement)
- Hermes bytecode compilation
- AGPL-3.0 license headers
- F-Droid metadata YAML
- `SECURITY.md`, `PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md`
- `ARCHITECTURE.md`, `API.md`, `DEPLOYMENT.md`
- User guides (Customer + Runner)
- GitHub Releases with signed APKs + SHA256
- F-Droid submission + GrapheneOS Apps repo submission

**Dependencies**: Phase 11 passes

**Test Gate**:
- [ ] Reproducible builds verified (same APK hash from source)
- [ ] `narvy-cli` SAST passes on release builds
- [ ] F-Droid build server builds successfully
- [ ] GrapheneOS Apps repo accepts submission
- [ ] Mainnet payment flow works (small amounts)
- [ ] All documentation complete and accurate
- [ ] CHANGELOG.md for v1.0.0

**Risks**:
- F-Droid review timeline (weeks)
- Reproducible build configuration complexity
- Mainnet Monero node operational burden
- Legal/compliance review for AGPL-3.0

---

## Summary Timeline (Estimated)

| Phase | Est. Duration | Cumulative |
|-------|---------------|------------|
| 1: Schema | 2 weeks | 2w |
| 2: Customer Skeleton | 3 weeks | 5w |
| 3: Runner Skeleton | 2 weeks | 7w |
| 4: Relay + Tor | 3 weeks | 10w |
| 5: Signal Protocol | 4 weeks | 14w |
| 6: Photo + ZK | 4 weeks | 18w |
| 7: Proof Bundle + IPFS | 3 weeks | 21w |
| 8: Admin Service | 3 weeks | 24w |
| 9: Monero Gateway | 4 weeks | 28w |
| 10: Discovery + Order | 3 weeks | 31w |
| 11: E2E Integration | 4 weeks | 35w |
| 12: Production Deploy | 3 weeks | 38w |

**Total**: ~9 months (38 weeks) for v1.0.0

---

## Parallelization Notes

- **Tracks A/B/C** (Phases 2,3,4,5,6,7) can run in parallel by separate engineers once Phase 1 done
- **Track D** (Phases 4,8,9) starts when Phase 4 has working Tor
- **Integration** (Phase 11) is the true synchronization point — budget 40% of remaining timeline
- **Mock adapters** for each track allow UI development in parallel

---

## Open Questions

- **OQ-ROAD-001 (resolved by ADR-0019, ADR-0030, and refinement C19)**: Mopro/GPU is an additional optional prover backend; Zakura-optimized CPU remains the fallback, with unmodified `@ajna-inc/poe-proofs` CPU as the interim path if the Zakura port is delayed. Retain ADR-0027's lower-precision CPU retry; coarse geohash remains the final fallback if that retry fails or CPU proving exceeds five seconds.
- **OQ-ROAD-002 (resolved by ADR-0009 and refinement C16)**: AcceptXMR remains the canonical Rust gateway; do not fall back to MoneroPay/Node.js. If AcceptXMR proves unusable, Admin/Developer must propose a Rust-compatible alternative through an ADR before Phase 9.
- **OQ-ROAD-003**: Phase 11 — how many physical devices for concurrent testing? Budget for 4 (2 customer + 2 runner)?
- **OQ-ROAD-004**: F-Droid submission timing — start metadata preparation in Phase 10?