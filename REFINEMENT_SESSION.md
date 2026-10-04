# DAMZ — Refinement Session (grill-with-docs)

**Version**: 1.0
**Status**: Complete
**Started**: 2026-10-04
**Completed**: 2026-10-04
**Method**: `grill-with-docs` (grilling + domain-modeling). Decisions are worked as a
design tree in rounds.
**Owner**: Admin/Developer

**Source documents under review**

- `SPEC.md` — technical specification v1.0 (architecture, libraries, flows)
- `DB_LAYOUT_AND_ARCH.md` — three-database layout (Customer, Runner, Admin)
- `DB_ARC_and_TEST_PLANNING.md` — three-tier storage + V-Model test strategy

---

## Contradictions found during fact-finding

| # | Topic | `DB_LAYOUT_AND_ARCH.md` says | `DB_ARC_and_TEST_PLANNING.md` says | `SPEC.md` says |
|---|-------|------------------------------|-------------------------------------|----------------|
| C1 | Central server | A **server-side** Admin Dashboard DB exists | **"No Central Database Server" is non-negotiable** | Admin dashboard exists implicitly |
| C2 | Schema shape | **Three separate** DBs with overlapping `orders`/`messages` | **One unified** local schema | — |
| C3 | Identity tables | `customer_identity`, `runner_identity` | single `identity` | DID + pseudonym |
| C4 | DID method | `did:key` / `did:ethr` | — | `@credebl/ssi-mobile` is **Hyperledger Indy** based |
| C5 | Monero scope | "Prepared, not active" | Payment tested end-to-end | Monero core to order lifecycle |
| C6 | Message retention | 90 days | **30 days** | — | ✅ resolved by Q9 (messages 30d, orders 90d, freeze on dispute) |
| C7 | Cancellation | only **before payment** | "**Any → cancelled**" | — |
| C8 | Catalog domain | 7 grocery items | — | titled "Medicine & Herb" |
| C9 | Customer strikes | Local on device; admin issues via dashboard | — | local-only can't receive admin strike |
| C10 | Proof key derivation | HKDF with an undefined `masterKey` IKM | — | Both derive "from the order ID" | ✅ resolved by Q12 (per-order random key over chat) |
| C11 | Runner delivery address | customer row has address; **runner row has none** | — | Runner must reach the address |
| C12 | Walk-away bug | `unsafeResetDatabase()` used where `VACUUM` intended — wipes the DB | — | — |

---

## Round 1 — Foundation — ANSWERED

### Q1 — What is DAMZ selling in v1? → **A. Fixed 7-item grocery basket**

Confirmed: the eight items (Cabbage, Spinach, Cinnamon, Cauliflower, Rock Salt, Flour,
Bicarbonate of Soda, Grape Soda (Small Bottle)) are the real v1 catalog. Medicine & herbs are a later concern.
Resolves **C8**.

### Q2 — Central authority? → **B. One minimal Tor-hidden admin service**

You are the authority (admin + developer). A single bounded server holds admin-only
data. It must **never** hold order, chat, or message content. Resolves **C1**.
Recorded as ADR-0001.

### Q3 — Schema shape? → **A. One shared schema, role-scoped** (delegated; recommended)

One schema package (`packages/db`) defines every table once. Both devices carry the
same tables; each device only **writes the columns it owns**. The "who owns which
field" rule (`status` = runner, `confirmed` = customer) is enforced at the query layer,
not by duplicating tables. Resolves **C2, C3**. Admin reuses the same type definitions.

### Q4 — Monero v1 scope? → **Mocked, but structurally prepared**

No live Monero in v1. The payment layer is built behind a stable interface/facade with
a mock adapter, so a real gateway (MoneroPay / AcceptXMR) can be dropped in later
without schema change. Resolves **C5**.

### Q5 — DID method? → **B. `did:key`** (delegated; recommended)

Self-certifying, no ledger, no network — fits offline-first Tor. The credebl/Indy stack
is dropped for v1. Resolves **C4**. Recorded as ADR-0002.

### Q6 — Runner delivery address? → **C. Coarse geohash local, exact address in chat**

Runner stores a coarse geohash on its own order row for offline navigation; the exact
address is only ever in the encrypted Signal chat. Resolves **C11**.

---

## Round 2 — Database layout — ANSWERED (2026-10-04)

**Answers: Q7 → B · Q13 → A · Q14 → A · Q15 → B · Q9 → A · Q12 → A**

### Q7 → B. Admin service holds registry, bans, disputes, strikes, settings

- Server tables: `admin_identity`, `runner_registry`, `disputes`, `strikes`,
  `platform_settings`.
- A dispute receives only voluntarily shared evidence: `order_id`, `proof_cid`, and the
  per-order proof key. Never order or chat content.
- Matches ADR-0001 as written; no ADR change needed.
- Device-side `strikes` / registry / settings become **read-only mirrors** (see Q11).

### Q13 → A. One wide `orders` table, per-column ownership

- `orders` is the union of both sides' columns; each app writes only the columns it owns.
  The per-column ownership matrix becomes part of the schema documentation.
- Runner-only columns (e.g. `delivery_geohash`) are NULL on the Customer device;
  Customer-only columns (`monero_subaddress`, `payment_txid`, `expires_at`) are NULL on
  the Runner device.
- Supersedes the two separate `orders` tables in `DB_LAYOUT_AND_ARCH.md`; **C2 closed**.

### Q14 → A. Runner publishes a signed price list; the order freezes a snapshot

- New `runner_prices`: per item — price, availability, DID signature, `fetched_at`.
  The Runner writes its own rows; the Customer caches other Runners' rows read-only.
- New `order_items`: one row per line, carrying the unit price at order time.
  `orders.total_zar` is derived from that snapshot and never moves afterwards.
- Ordering needs the list *before* payment, so the Customer app orders from its cache and
  refreshes the cache when online.
- Recorded as ADR-0004.

### Q15 → B. Messages store the decrypted body; the envelope lives only until sent

- `messages.body` (SQLCipher-protected) is the readable text. `messages.envelope` is
  nullable and cleared once the send succeeds; until then it is the retry payload.
- Delivery state + attempt count live on the message row, so there is no separate outbox
  table.
- "Zero plaintext at rest" in `DB_ARC` still holds — the plaintext is inside the
  SQLCipher file, not beside it.
- History stays readable after a Signal session is terminated.

### Q9 → A. Messages 30 days, orders 90 days, frozen under an open dispute

- Purge keys off a per-row `purge_after`; presence of an open dispute freezes the row.
- Supersedes the 90-day message window in `DB_LAYOUT_AND_ARCH.md`; **C6 closed**.
- Purge must be a real `DELETE` plus periodic `VACUUM` — WatermelonDB's `markAsDeleted`
  tombstones never clear without a sync server. **This is the C12 fix**;
  `unsafeResetDatabase()` was never the vacuum call.

### Q12 → A. Per-order random proof key, sent over the order chat

- `orders.proof_key` exists on both devices (SQLCipher-protected). The photo itself is
  fetched on demand and never kept locally.
- The Admin can decrypt a bundle only when the Customer hands over that one key, which is
  exactly the Q7 dispute evidence.
- Recorded as ADR-0003; **C10 closed**.

### Derived, not asked (follow from Q3 / Q5 / Q6 — veto in Round 3 if wrong)

- One `identity` row per device (self) plus `contacts` keyed by **DID**, each holding the
  Signal address and onion address. `customer_identity` / `runner_identity` /
  `runner_contacts` are superseded; **C3 closed concretely**.
- Order IDs are random UUIDv4 minted by the Customer; the Runner adopts the ID verbatim.
- The Customer device keeps **no** delivery-address column — the address lives only in the
  order chat (Q6). `delivery_address_type` / `delivery_address_value` are dropped; the
  Runner keeps a coarse `delivery_geohash`.
- `catalog` splits into a fixed 7-row `catalog_items` reference (id + label, seeded) and
  the Runner-owned price rows in `runner_prices`.

---

## Round 3 — Lifecycle, mirrors, remaining shape — ANSWERED (2026-10-04)

**Answers: Q8 → C · Q10 → C · Q11 → B · Q17 → A · Q18 → A · Q20 → A**

### Q8 → C. Payment seam is an interface plus a `payment_events` audit table

- `PaymentProvider` interface: `requestPayment(order) → {subaddress, amount, expiresAt}`
  and `checkStatus(order) → pending | confirmed | expired`; `MockPaymentProvider` in v1.
- `payment_events` (requested / seen / confirmed / expired, with timestamps) is written by
  the device that observes the transition — the Customer device in v1.
- No server involvement, so ADR-0001 is untouched: the gateway is not the admin service.

### Q10 → C. Cancellation is free until `accepted`; after that, a dispute

- Transition ownership becomes explicit:
  | Edge | Actor |
  |---|---|
  | `pending_payment → paid` | Customer |
  | `pending_payment / paid → cancelled` | Customer (any time before acceptance) |
  | `pending_payment / paid → cancelled` with `cancel_reason = 'cannot_fulfil'` | Runner |
  | `paid → accepted` | Runner |
  | `accepted → in_transit → delivered` | Runner |
  | `delivered → confirmed` | Customer |
  | `pending_payment → expired` (payment window lapses) | whichever device observes it |
  | `accepted ∈ open dispute` | Customer raises, Admin adjudicates |
- New columns: `cancelled_by`, `cancel_reason`. `dispute_state` becomes a separate field
  mirrored from the admin service, **not** a status value — a dispute does not stop the
  delivery state machine, it freezes purge and adjudicates afterwards. **C7 closed.**

### Q11 → B. Devices keep read-only mirrors, with a `sync_state` cursor

- `sync_state` (source PK, `last_success_at`, `cursor`, `last_error`) records the last
  successful pull per source: `strikes`, `settings`, `directory`, `disputes`.
- Mirrored read-only: `strikes`, `platform_settings`, `runner_directory`, `disputes`.
  Offline, the app shows and enforces the last known state; it can never write these.
- `disputes` is the one mirror with a local draft row (a Customer raises a dispute
  offline, it uploads when Tor is back). **C9 closed.**

### Q17 → A. One shared `proof_bundles` table

- Runner-written: `cid`, `captured_at`, `capture_geohash`, `signature_valid`, `uploaded_at`.
- Customer-written: `verified_at`, `verification_result`, `verification_note`.
- `orders.proof_cid` stays as the pointer; `orders.proof_key` holds the key (Q12).
  A rejected proof is re-uploaded as a new `proof_bundles` row, leaving the order intact.

### Q18 → A. Admin service stores SQLite + SQLCipher

- One encrypted file, WAL mode, single process, single admin. Backup = copy the file.

### Q20 → A. The Customer device has no delivery-address column

- `delivery_address_type` / `delivery_address_value` are dropped. The address exists only
  as the body of an order-chat message (Q6, ADR-worthy consistency with the proof-key
  design: exactly one copy, in exactly one place).

### Derived, added during Round 3

- `wallet_metadata` belongs on the **Runner** device: the Runner is the payee, so the
  subaddress on an order is theirs (confirmed by Q22).
- `runner_registry.total_orders_completed` is **dropped**: the admin service cannot count
  orders without holding order data, which ADR-0001 forbids.
- Exact delivery coordinates are never persisted — they exist in memory only while
  generating the ZK location proof; the database keeps a coarse geohash.

---

## Round 4 — Two loose ends — ANSWERED (2026-10-04)

**Answers: Q21 → A · Q22 → A**

### Q21 → A. Runners never see Customer strikes

- `strikes` is mirrored read-only onto the **Customer's own device only**. The Runner app
  ships without the table, so the admin service never becomes a lookup oracle that maps
  runners to the customers they are about to serve.
- Abuse is handled reactively: a Runner contacts the Admin out of band, the Admin issues a
  strike, the Customer's device mirrors it.
- Recorded as **ADR-0005**, including the honest limitation: a Customer can rotate to a new
  `did:key` to escape strikes, just as a Runner can escape a ban.

### Q22 → A. The wallet lives on the Runner device

- The Runner is the payee, so the subaddress on an order is theirs and `wallet_metadata`
  lives on their device only. No server-side hot wallet, no Customer wallet in v1.
- The Customer app keeps `payment_events` and nothing wallet-shaped.

---

## Session closed — frontier empty (2026-10-04)

Every branch of the database-layout design tree has an answer. 20 decisions recorded, 5 ADRs
written, 3 glossary terms added, 10 of 12 contradictions closed (C1–C11; **C12** was not a
contradiction but a bug and is fixed in the v2 layout).

**Deliverable**: `DB_LAYOUT_AND_ARCH.md` v2 supersedes v1 and Part I of
`DB_ARC_and_TEST_PLANNING.md`.

**Explicitly out of v1** (recorded in §9 of the v2 layout, so nothing is silently assumed):
runner→admin reports, ratings/reputation, inventory counts, refunds as anything other than
a dispute outcome, and exact delivery coordinates as a persisted value.

---

## Post-refinement addendum — schema inventory reconciliation (ADR-0043)

**Date**: 2026-10-04
**Owner**: Admin/Developer
**Status**: Accepted documentation decision; implementation deferred to the schema phase.

### C13 — Client/Admin schema inventory and validator disagree

**Observed state**:

- `DB_LAYOUT_AND_ARCH.md` §§2–4 and `packages/db/OWNERSHIP_CONTRACT.md` enumerate the
  same 19 client-side tables.
- `packages/db/src/schemas/schema.ts`, `packages/db/src/models/index.ts`, and
  `packages/types/src/index.ts` currently implement only 16; `swaps`, `exchange_offers`,
  and `swap_events` are absent from those artifacts.
- `ROADMAP.md` stated that the WatermelonDB schema contains 20 tables, but no twentieth
  client table is defined in the v2 layout or ownership contract.
- `services/admin/SPEC.md` defines five separate Admin-service tables. The refinement
  statement that Admin reuses the client schema types conflicts with ADR-0007's separate
  Rust/API contract.
- `packages/db/scripts/validate-schema.ts` searches for SQL `CREATE TABLE` statements in
  a TypeScript `Schema(...)` file, so its current parsing strategy does not validate the
  actual client schema.

### Resolution

Following ADR-0043, the canonical client-side inventory is 19 tables: the 16 implemented
client tables plus the three converter tables already approved in v2. At the time of this
reconciliation, the Admin service had five tables in its separate server-side schema; ADR-0029
later adds the Admin-only `wipe_pending` table as a narrow control-plane extension. Neither
the original five nor the later sixth Admin table is part of the mobile table count. The
roadmap count is corrected to 19. Admin/client interoperability is through the service API
contract, not shared WatermelonDB schema artifacts. No twentieth client table is introduced,
and the three approved converter tables are not removed.

### Alternatives considered

- Keep the roadmap count at 20 by inventing or inferring a client table — rejected because
  no such table is defined in v2.
- Count Admin-service tables in the client schema — rejected because the Admin database is
  separate and is not installed on Customer or Runner devices.
- Remove converter tables from v2 — rejected because they are already specified in the
  approved layout and ownership contract.

### Consequences and follow-up

The schema implementation must add the three documented converter tables using an
additive migration; the validator and schema-parity tests must inspect the real TypeScript
schema. These implementation steps are deferred until after the documentation review gate.
Open questions OQ-SCHEMA-001 and OQ-SCHEMA-002 in ADR-0043 have owner Admin/Developer and
must be resolved before the Phase 1 schema migration/validation test gate. No TODOs are
introduced by this addendum.

---

## Post-refinement addendum — native wallet memory and wallet scope (ADR-0028)

**Date**: 2026-10-04
**Owner**: Admin/Developer
**Status**: Accepted documentation decision; implementation deferred to the Customer and Runner wallet phases.

### C14 — Monero backup phrase length conflicts across approved documents

**Observed state**:

- ADR-0026 and `DB_LAYOUT_AND_ARCH.md` specified a 24-word seed phrase.
- `DB_ARC_and_TEST_PLANNING.md` described the Monero seed as a 25-word mnemonic.
- `MoneroWallet.ts` currently returns a mnemonic as a JavaScript string and accepts a seed string for restore. `DB_ARC_and_TEST_PLANNING.md` also allowed a private view key through JavaScript `expo-secure-store`; both flows conflict with the selected wallet-secret boundary.

**Resolution**:

The user selected the complete 25-word Monero mnemonic as the canonical backup/recovery artifact and native-only handling for all wallet secrets, including private spend/view keys. Seed and spend-key access is biometric-only with no PIN fallback; the user approved a narrow exception allowing a PIN-derived HKDF key for an optional private view key, with all derivation and secret handling native-only. ADR-0028 supersedes ADR-0026 for phrase length and this view-key exception; remaining Runner-specific duress PIN, subaddress-label, fee-preview, and no-cloud-backup decisions remain. Phrase generation, display, entry, and private-key operations remain native-only. No wallet secret is represented as a JavaScript string, JSI string, typed array, or other JavaScript-managed value; JavaScript receives only non-secret status and metadata.

**Alternatives considered**:

- Keep the 24-word app-specific phrase — rejected in favor of the complete 25-word Monero mnemonic selected by the user.
- Permit JavaScript to handle the phrase only during backup or recovery — rejected because it breaks the wallet-secret invariant.
- Permit the private view key through JavaScript secure-store calls because it is not the mnemonic — rejected; the user selected native-only handling for all wallet secrets.

### C15 — Wallet placement and ownership conflict between Q22 and the app flows

**Observed state**:

- Refinement decision Q22 and the approved v2 layout placed `wallet_metadata` on the Runner device only.
- `ROADMAP.md` Phase 2 assigned seed backup to the Customer app, and `SPEC.md` already depicted a Customer Monero wallet and Customer-to-Runner payment flow.
- ADR-0038's biometric permission row named Runner wallet setup; the Customer onboarding gate also requires biometric-gated wallet access.
- The 19-table client schema already contains `wallet_metadata`; Admin has a separate server schema.

**Resolution**:

The user chose to retain the Runner wallet and add an independent, device-local Customer wallet. Each app controls only its own wallet; both use biometric-gated native wallet access, and there is no shared or Admin-held wallet or central user database. ADR-0028 supersedes Q22's Runner-only placement. The existing `wallet_metadata` table is used in each app's own local database for non-secret metadata, so the client inventory remains exactly 19 tables and Admin remains separate. The Customer wallet is the payer wallet; the Runner wallet remains the receiving/payee wallet.

**Alternatives considered**:

- Keep the wallet Runner-only and remove Customer wallet flows — rejected by the user's decision to have a Customer wallet too.
- Add a twentieth client table for the Customer wallet — rejected; the existing local `wallet_metadata` table is reused and the accepted 19-table inventory remains unchanged.
- Store either wallet centrally — rejected because it would violate the v2 local-first/anonymity boundary.

### Consequences and follow-up

`docs/adr/0028-secure-memory-management.md` records both resolutions and their replacement contracts. `docs/adr/0026-wallet-ux.md` retains its historical 24-word decision with an explicit partial-supersession note; its remaining Runner UX decisions stay accepted. `DB_LAYOUT_AND_ARCH.md`, `packages/db/OWNERSHIP_CONTRACT.md`, `SPEC.md`, `THREAT-MODEL.md`, `DB_ARC_and_TEST_PLANNING.md`, `ROADMAP.md`, `ARCHITECTURE.md`, and ADR-0038's biometric scope are aligned to the two local wallets, the 25-word native-only phrase UI, and the native-only boundary for seeds and private wallet keys. The tracked `DB_LAYOUT_AND_ARCH.md.tmp` snapshot is explicitly marked non-authoritative so its older schema and wallet wording is not used as a current decision.

`packages/core/src/monero/MoneroWallet.ts` remains an explicitly noncompliant scaffold: replacing its JavaScript seed-string API is deferred; no runtime implementation or tests are performed in this documentation directive. Open Questions OQ-SEC-MEM-001 and OQ-SEC-MEM-002 have owner Admin/Developer and must be resolved before Customer wallet onboarding in Phase 2 and Runner wallet onboarding in Phase 3. The corresponding test cases are specified as pending in `DB_ARC_and_TEST_PLANNING.md`. No unresolved question is left without an owner and target phase.

---

## Post-refinement addendum — gateway reference consistency (ADR-0009)

**Date**: 2026-10-04
**Owner**: Admin/Developer
**Status**: Accepted clarification; ADR-0009 remains authoritative.

### C16 — Monero gateway references conflict

**Observed state**:

- ADR-0009 and `SPEC.md` §5.2 select a custom Rust gateway using the AcceptXMR library and explicitly reject MoneroPay.
- The architecture diagram, data-flow text, repository tree, and several roadmap/service references still named MoneroPay as the active gateway or fallback.

**Resolution**:

The user reaffirmed AcceptXMR as the canonical gateway. This does not change ADR-0009. Active architecture, data-flow, and service references are aligned to the custom Rust/AcceptXMR gateway. OQ-ROAD-002 is resolved: do not fall back to MoneroPay/Node.js; if AcceptXMR proves unusable, Admin/Developer must propose a Rust-compatible replacement through an ADR before Phase 9.

**Alternatives considered**:

- Use MoneroPay/Node.js as the active gateway or automatic fallback — rejected in favor of the existing ADR-0009 Rust decision and the user's confirmation.

**Consequences**:

`SPEC.md`, `ROADMAP.md`, `services/gateway/SPEC.md`, and the Track D reference in ADR-0011 use AcceptXMR as the active gateway. ADR-0009 is unchanged, and no runtime gateway code, tests, or builds are changed in this documentation pass.

---

## Post-refinement addendum — native private-view-key access (ADR-0028)

**Date**: 2026-10-04
**Owner**: Admin/Developer
**Status**: Accepted clarification; native implementation deferred to the wallet phases.

### C17 — Private view-key authentication and memory boundary conflict

**Observed state**:

- `DB_ARC_and_TEST_PLANNING.md` allowed an optional private view key to use JavaScript-facing `expo-secure-store` and biometric/PIN-derived HKDF.
- ADR-0028's accepted wallet-secret boundary excludes all Monero private keys from JavaScript; ADR-0038 specifies biometric-only seed/spend-key access with no PIN fallback.
- The separate AcceptXMR gateway already holds the Runner's private view key in encrypted view-only configuration, but never receives a spend key (ADR-0009; `services/gateway/SPEC.md`).

**Resolution**:

The user confirmed that all Monero wallet secrets—including the seed, spend keys, and any locally persisted private view key—remain native-only within both mobile apps. This does not change the existing AcceptXMR gateway's separate encrypted Runner view key or its view-only/no-spend-key boundary. Seed and spend-key access is biometric-only with no PIN fallback. The optional private view key may use a PIN-derived HKDF key as a narrow exception to biometric-only access, but its PIN handling, derivation, local storage, and use remain inside native `SecureMemory`; neither PIN nor local key enters JavaScript. ADR-0028 records this exception, and ADR-0026/ADR-0027/ADR-0038 now scope the no-PIN rule to seed/spend-key access.

**Alternatives considered**:

- Make the optional private view key biometric-only like the seed/spend keys — rejected by the user's choice of the narrow native PIN-derived option.
- Allow the private view key to pass through JavaScript because it is not the mnemonic — rejected; it is still a wallet secret.

**Consequences**:

`DB_ARC_and_TEST_PLANNING.md` now specifies native-only view-key storage and derivation, removes the superseded Part I schema example's `view_key_encrypted` column to match the canonical v2 metadata table, and includes pending tests for the PIN-HKDF exception. No runtime code or tests are created or run in this documentation phase.

---

## Post-refinement addendum — managed Android app-data remote wipe (ADR-0029)

**Date**: 2026-10-04
**Owner**: Admin/Developer
**Status**: Accepted documentation decision; implementation deferred to the Customer, Runner, and Admin phases.

### C18 — Remote-wipe scope and Admin-boundary conflict

**Observed state**:

- The Admin service was documented as moderation-only in ADR-0001, ADR-0007, and ADR-0041, while the requested `wipe_pending` feature requires a narrowly scoped device-control queue.
- The Admin service had five server-side tables, separate from the canonical 19 client-side WatermelonDB tables. A remote-wipe queue must not become a client table or be included in that 19-table count.
- The request established managed Android as the only supported platform, but the phrase “remote wipe” did not itself distinguish DAMZ app-data deletion from an operating-system factory reset. The user clarified that the command erases DAMZ app data and keys only; it does not reset the device. iOS and unmanaged Android are excluded.

**Resolution**:

ADR-0029 adds `wipe_pending` as the sixth, Admin-only table for minimal, pseudonymous, target-bound command metadata. This is an explicit narrow extension of the Admin authority, not a central user database: no device serial, advertising ID, profile, location, wallet material, order/chat/proof content, or exported user content is stored. The client schema remains exactly 19 tables, and the Admin schema remains separate.

Only a verified enrolled managed Android Customer or Runner installation may receive a command. Admin CLI issuance requires fresh authentication, exact typed DID/app confirmation, verified management enrollment, an Admin Ed25519 signature, a one-time nonce, and a bounded expiry. Delivery is target-bound over the existing DID-signed Admin API through Tor. The native app handler stops wallet work, zeroizes native wallet buffers, deletes app-scoped keys and credentials, removes the SQLCipher database and sidecars, and clears app-private caches. `accepted` means the command was accepted; `completed` is only the app's report after its native handler succeeds. The feature is best effort and does not claim forensic sanitization, full-device reset, or execution on an offline/force-stopped/uninstalled device. It cannot erase iOS/unmanaged installations, other devices, remote copies, Admin moderation records, or the gateway's separate Runner view key.

ADR-0001, ADR-0007, and ADR-0041 are explicitly narrowed by ADR-0029 only to permit this command metadata; all exclusions of order, message, and proof content and the prohibition on a central user database remain. The exact management-enrollment proof and Android wipe-interruption behavior remain owned implementation gates, not implicit capabilities.

**Alternatives considered**:

- Factory-reset a managed device — rejected by the user's app-data-only choice and would require a different, broader device-management authority.
- Add iOS or unmanaged Android support — rejected; neither platform is covered by this mechanism.
- Add a twentieth client table for wipe jobs — rejected; wipe command state belongs only to the separate Admin schema.
- Claim guaranteed/forensic deletion or mark a command complete on delivery — rejected because device availability and flash-storage behavior cannot support that claim.

**Consequences and follow-up**:

`docs/adr/0029-managed-android-app-data-remote-wipe.md`, `docs/adr/0038-app-lifecycle.md`, `services/admin/SPEC.md`, `DB_LAYOUT_AND_ARCH.md`, `SPEC.md`, `ARCHITECTURE.md`, `THREAT-MODEL.md`, `ROADMAP.md`, `DB_ARC_and_TEST_PLANNING.md`, `CONTEXT.md`, `GLOSSARY.md`, the Admin-scope/API ADRs, and the client ownership contract document the same platform/scope/schema boundary. `OQ-SEC-WIPE-001` (verified enrollment proof and DID binding) is owned by Admin/Developer and must be resolved before Phase 8 remote-wipe API acceptance and rollout. `OQ-SEC-WIPE-002` (native Android deletion, sidecars, and interrupted-wipe validation) is owned by Admin/Developer and must be resolved at Customer Phase 2 and Runner Phase 3 native-wipe gates before Phase 8 end-to-end acceptance. `OQ-SEC-WIPE-003` (finite retention for encrypted Admin backup snapshots containing terminal wipe-target DIDs) is owned by Admin/Developer and must be resolved before Phase 8 production deployment. Planned test cases are recorded but remain unrun. No runtime code, installations, or builds are changed in this documentation directive; no TODOs are introduced.

---

## Decision Log

| ID | Decision | Status |
|----|----------|--------|
| Q1 | v1 sells the fixed 7-item grocery basket | ✅ A |
| Q2 | One bounded admin service; you are the authority | ✅ B |
| Q3 | One shared schema, role-scoped writes | ✅ A |
| Q4 | Monero mocked but structurally prepared | ✅ |
| Q5 | Identity via `did:key` | ✅ B |
| Q6 | Coarse geohash local, exact address in chat | ✅ C |
| Q7 | Admin service data scope | ✅ B |
| Q8 | Payment seam + `payment_events` audit | ✅ C |
| Q9 | Retention: msgs 30d / orders 90d / dispute freeze | ✅ A |
| Q10 | Cancellation: free until accepted; dispute after | ✅ C |
| Q11 | Read-only moderation mirrors + `sync_state` | ✅ B |
| Q12 | Per-order random proof key over chat | ✅ A |
| Q13 | One wide `orders` table, per-column ownership | ✅ A |
| Q14 | Runner publishes price list; order freezes snapshot | ✅ A |
| Q15 | Decrypted body + outbox-only envelope | ✅ B |
| Q17 | Shared `proof_bundles` table | ✅ A |
| Q18 | Admin service engine: SQLite + SQLCipher | ✅ A |
| Q20 | No address column on the Customer device | ✅ A |
| Q21 | Runners never see customer strikes | ✅ A (ADR-0005) |
| Q22 | Wallet was Runner-only | Superseded by ADR-0028 (Customer + Runner local wallets) |
| Q23 | Customer and Runner each have an independent local Monero wallet | ✅ ADR-0028 |
| Q24 | Remote wipe is app-data/key erasure on verified managed Android only; no full-device reset, iOS, or unmanaged Android | ✅ ADR-0029 |
| Q25 | Mopro/GPU is an additional ZK prover; retain Zakura/CPU fallback | ✅ ADR-0030 |

## ADRs created

- `docs/adr/0001-bounded-admin-service.md`
- `docs/adr/0002-did-key-identity.md`
- `docs/adr/0003-proof-bundle-key.md`
- `docs/adr/0004-published-prices.md`
- `docs/adr/0005-strike-visibility.md`

## Glossary created

- `GLOSSARY.md`

---

## ADR numbering reconciliation — reserve ADR-0028 through ADR-0032

**Date**: 2026-10-04
**Owner**: Admin/Developer
**Status**: Accepted

### Context

The requested security decisions use ADR-0028 through ADR-0032, but those identifiers
already name accepted decisions. Reusing them would overwrite the existing decision
record and break references. The user confirmed that the existing decisions should be
renumbered so the requested ADRs can retain their specified identifiers.

### Decision

Move the existing accepted ADRs 0028–0037 forward by five IDs, preserving each decision,
filename topic, and status. The five requested ADRs will use the newly available IDs
0028–0032. Update all in-repository references to use the new identifiers.

| Previous ID | Preserved decision | New ID |
|---|---|---|
| ADR-0028 | Admin Service API Endpoints | ADR-0033 |
| ADR-0029 | Relay Protocol Specification | ADR-0034 |
| ADR-0030 | Dispute Resolution Flow | ADR-0035 |
| ADR-0031 | Push Notifications: UnifiedPush | ADR-0036 |
| ADR-0032 | Centralized Error Handling | ADR-0037 |
| ADR-0033 | App Lifecycle & Permissions | ADR-0038 |
| ADR-0034 | Build & CI/CD Pipeline | ADR-0039 |
| ADR-0035 | Documentation & Legal | ADR-0040 |
| ADR-0036 | Bounded Admin Service Limits | ADR-0041 |
| ADR-0037 | Testing Methodology and Tool Selection | ADR-0042 |

### Alternatives considered

- Assign the five new security decisions IDs 0038–0042 — rejected because the user
  confirmed the requested IDs 0028–0032.
- Replace or delete the accepted ADRs already numbered 0028–0032 — rejected because that
  would lose accepted decisions and their audit history.

### Consequences

This is an identifier and reference migration only. No existing design decision is removed,
reversed, or superseded by the renumbering. The updated ADR files and this mapping preserve
traceability; all future in-repository references use the new IDs. ADR-0028 (Secure Memory)
and ADR-0029 (Managed Android App-Data Remote Wipe) were subsequently added as separately
reviewed directives. ADR-0030–0032 were reserved at the time of this reconciliation; ADR-0030
was later assigned to the Mopro/GPU backend decision recorded in the C19 addendum below,
while ADR-0031 and ADR-0032 remain reserved.

---

## Post-refinement addendum — optional Mopro/GPU ZK backend (ADR-0030)

**Date**: 2026-10-04
**Owner**: Admin/Developer
**Status**: Accepted architecture decision; implementation deferred to Phase 6.

### C19 — Mobile GPU backend scope and Zakura CPU fallback

**Observed state**:

- ADR-0019 selects a Zakura-optimized CPU prover path and says to retain the unmodified
  `@ajna-inc/poe-proofs` CPU implementation if the Zakura port is delayed. Its performance
  fallback and ADR-0027's ZK degradation path use coarse geohash when proof generation is
  too slow or fails.
- `ROADMAP.md` OQ-ROAD-001 asked whether to ship the baseline prover if Zakura is delayed;
  it did not define how a mobile GPU backend would relate to the existing CPU path.
- Mopro's official mobile overview documents a modular mobile proving toolkit, native
  adapters/bindings, and GPU acceleration for operations such as MSM. Its performance
  guidance says results vary by circuit and custom circuits need to be benchmarked. These
  general claims do not establish support for DAMZ's exact floating-point location circuit,
  proof parameters, verification key, or mobile app integration.
- The user explicitly chose Mopro/GPU as an **additional** backend and directed that the
  Zakura/CPU fallback be retained.

**Resolution**:

ADR-0030 adds Mopro/GPU as an optional, on-device prover behind a compatibility gate and
feature flag; it does not replace Zakura/CPU or remove the unmodified `@ajna-inc/poe-proofs`
CPU interim path. All backend outputs must prove the same circuit statement with identical
public-input semantics, parameters, and verification key, and must pass the existing
Customer/Admin verifier. No remote proving service or new trust setup is introduced.

When enabled and validated, Mopro/GPU may be attempted first. If unsupported, over its
resource/time budget, or it errors or yields an invalid proof, the app falls back to CPU at
the requested precision (Zakura-optimized first, otherwise the unmodified baseline). A CPU
proving/verification failure retains ADR-0027's lower-precision CPU retry. If CPU proving
still fails or exceeds five seconds, coarse geohash is the final fallback and must be marked
as non-ZK. Invalid GPU output is never accepted. Coordinates, witnesses, and proving keys stay on
device; generated proofs follow the existing encrypted proof-bundle sharing flow, never a
remote proving service. If the platform cannot meet the native buffer/privacy gate, the GPU
backend remains disabled.

**Alternatives considered**:

- Replace or remove the Zakura/CPU path in favor of Mopro/GPU-only — rejected because the
  user chose an additional backend and mobile GPU support is not universal or validated.
- Assume Mopro works with the location circuit or infer DAMZ performance from general
  Mopro benchmarks — rejected because circuit compatibility and actual performance have
  not been demonstrated.
- Send proofs or witnesses to a remote GPU/proving service — rejected because it would
  disclose location data and violate the on-device proof boundary.
- Change the circuit, verification key, proof contract, or trusted setup to fit an adapter
  without a separate decision — rejected; those changes require review and an ADR.

**Consequences and follow-up**:

`docs/adr/0030-mopro-gpu-zk-backend.md` is the new authoritative decision. ADR-0019 remains
authoritative for Zakura CPU optimization; ADR-0027 retains the lower-precision retry and
coarse-geohash last resort. OQ-ROAD-001 is resolved: keep the existing CPU path if Zakura is
delayed, and do not remove the CPU fallback for Mopro. OQ-ZK-PROVER-001 (exact circuit,
parameter, and verifier compatibility) and OQ-ZK-PROVER-002 (device-matrix parity,
performance, resource/thermal behavior, and buffer handling) are owned by Admin/Developer
and must be resolved at the Phase 6 gate before enabling Mopro/GPU. If the gates fail,
Mopro remains disabled; the CPU path continues.

`SPEC.md`, `ROADMAP.md`, `DB_LAYOUT_AND_ARCH.md`, `DB_ARC_and_TEST_PLANNING.md`,
`THREAT-MODEL.md`, `CONTEXT.md`, ADR-0013, ADR-0019, and ADR-0027 are aligned to this
additive backend and fallback order. `DB_ARC_and_TEST_PLANNING.md` records pending
acceptance cases; no tests, builds, installations, or runtime changes were made. The client
schema remains 19 tables, Admin remains separate, and no user database or location data is
added centrally. No unresolved question is left without an owner and target phase; no TODOs
are introduced.

**External sources consulted**:

- Mopro mobile toolkit and GPU overview: https://zkmopro.org/docs/intro/
- Mopro circuit-specific performance guidance: https://zkmopro.org/docs/performance/
