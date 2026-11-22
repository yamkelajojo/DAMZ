# Gates: DAMZ mobile, relay, wallet, and map foundation

OWNS: GATES.md, DEVELOPMENT.md, ARCHITECTURE.md, Cargo.toml, Cargo.lock, bun.lock, .gitignore, apps/**/.gitignore, apps/**/eas.json, apps/**/package.json, apps/**/app.json, apps/runner/index.js, apps/runner/metro.config.js, apps/runner/.env.example, apps/runner/src/app/index.tsx, apps/runner/src/app/_layout.tsx, apps/runner/src/services/**, packages/core/src/monero/**, packages/core/src/relay/**, packages/core/src/tor/**, packages/core/src/payments/**, packages/core/src/index.ts, packages/core/src/__tests__/**, packages/core/jest.setup.js, packages/db/src/index.ts, packages/db/src/payment-notification-replay.ts, packages/db/src/__tests__/payment-notification-replay.test.ts, services/relay/**, services/gateway/**, docs/adr/**, scripts/verify-mobile-dev-build.mjs, scripts/verify-relay-protocol.mjs, scripts/verify-gateway-relay-notifications.mjs

Scope: establish an honest iPhone development path, implement an authenticated and end-to-end encrypted Gateway-to-Runner relay notification path, keep the wallet native boundary fail-closed and usable by non-wallet core modules, and decide whether the discovered offline map work belongs in DAMZ.

- [x] G14: the Gateway's new HPKE dependencies resolve in the workspace and the service compiles, updating Cargo.lock before locked checks run
  CHECK: cargo check -p damz-gateway
  EXPECT: Finished `dev` profile
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=fa3f5bf09803cd9ec4c37150b68ca138780dcccf2eaabded9c2231a2265ba2b7; output-bytes=167

- [x] G1: the iPhone runbook and Runner app accurately configure a native development build, persist its DID, and poll the encrypted inbox in the foreground
  CHECK: node scripts/verify-mobile-dev-build.mjs
  EXPECT: mobile development build configuration verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=1e348f29690fdec92c23f058f58264ce952b30a1aa8f74335275be2e8eedd29b; output-bytes=48

- [x] G15: the Runner app, native inbox service, and safe-area screen typecheck against the pinned Expo/React Native packages
  CHECK: bun run --filter @damz/runner typecheck
  EXPECT: Exited with code 0
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=cf098257e6cb4b5718d3dbfa1f7f562d6f091ab3a5369d9689c7206a8da6b0bb; output-bytes=43

- [x] G2: relay unit tests cover recipient polling/redelivery until acknowledgement, direct retrieval, expiry, and bounded capacity
  CHECK: cargo test -p damz-relay --locked
  EXPECT: test result: ok
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=31749cef5d2fc1e1d15d931ebed4bad228a0bd86745533815c589c789b95b837; output-bytes=760

- [x] G7: the documented relay routes and resource limits match the server, and the mobile client maps enqueue/poll/acknowledgement to those routes over Tor
  CHECK: node scripts/verify-relay-protocol.mjs
  EXPECT: relay protocol, mobile client, and implementation contract verified
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=06a68c76e3dafe116a1765e550fb11b3b1d6711d8d66b3b0d8ea41a4c4cafeca; output-bytes=68

- [x] G3: importing non-wallet core functionality does not require SecureMemory, wallet operations fail clearly when the native module is unavailable, and the mobile relay client handles enqueue/poll/acknowledgement
  CHECK: bun run --filter @damz/core test --runInBand
  EXPECT: /Test Suites: [1-9][0-9]* passed/
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=d1c88f7fa02af9f8847a8fe86572a0208ecf5f0d7bc19ddf4961bc071a471a03; output-bytes=281

- [x] G8: Gateway payment-monitor callbacks are authenticated, time-bounded, replay-protected, and cannot select the notification recipient
  CHECK: cargo test -p damz-gateway --locked
  EXPECT: test result: ok
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=fe96fcb759d0e8b19620f74a591f7b37d5a96dc7c8456e44e0abac16271c602e; output-bytes=1632

- [x] G9: Gateway creates an HPKE Auth envelope using DID-bound X25519 keys, sends only ciphertext to the relay, and reports enqueue failures
  CHECK: cargo test -p damz-gateway --locked
  EXPECT: test result: ok
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=1e4cd489337cb0ab73d1ac15ac171a258f67facfcd5be55de2f5f72a7bbe2fb4; output-bytes=1537

- [x] G10: Runner derives its DID key-agreement key, decrypts the notification, authenticates the configured Gateway DID, validates the event, and rejects replayed event IDs
  CHECK: bun run --filter @damz/core test --runInBand
  EXPECT: /Test Suites: [1-9][0-9]* passed/
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=0abaa8d2332beea8d60e696f6cb4a9c4b98f0ef25e9ea0e6edfee7ed0ed5b956; output-bytes=280

- [x] G13: Runner payment events persist before relay acknowledgement, restore after a crash, and reject duplicate event IDs on redelivery
  CHECK: bun run --filter @damz/db test --runInBand
  EXPECT: /Test Suites: [1-9][0-9]* passed/
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=f95a8c7e2122f1582d3da0a5cc2cb32e3194e5d71c6ecfe1e8bb35aa05c2fab6; output-bytes=269

- [x] G11: Gateway Rust and Runner TypeScript open each other's HPKE Auth envelopes and agree on sender/recipient key derivation, context, AAD, and envelope encoding
  CHECK: node scripts/verify-gateway-relay-notifications.mjs
  EXPECT: gateway notification wire contract verified (Rust ↔ TypeScript)
  EVIDENCE: exit=0; shell=C:\WINDOWS\system32\cmd.exe; cwd=C:\Users\Acer\Documents\Software\2026\DAMZ; path=50145446bf1b/61 entries; EXPECT=matched; output-sha256=a6d2e6a3837772cc275dfceecc9900c1e176ee5589cbcca91d208102ceafecb1; output-bytes=66

- [x] G4: the two offline-map references are evaluated against DAMZ's location-privacy model and the proposed local-only map approach is documented before copying code or assets
  EVIDENCE: ADR-0044 records both references, rejects live coordinate polling and external location services, and notes the PMTiles/device-validation gaps; no map code or assets were copied.

- [x] G5: native wallet operations remain explicitly release-blocked until iOS and Android SecureMemory implementations and device evidence exist
  EVIDENCE: existing ADR-0028 and ARCHITECTURE.md state the implementation gap; DEVELOPMENT.md now carries the release block and MoneroWallet checks SecureMemory only when wallet operations are called.

- [ ] G12: encrypted Gateway notifications are installed and received by Runner on a physical iPhone
  EVIDENCE: pending (target device: iPhone 17; after automated gates G1-G3, G7-G11, and G13-G15 pass, enable notifications only on an isolated development Gateway)

- [ ] G6: a Customer app development build has been installed and launched on the target physical iPhone, with native-feature limitations recorded
  EVIDENCE: pending (target device: iPhone 17)
