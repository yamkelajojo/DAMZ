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
client tables plus the three converter tables already approved in v2. The Admin service
has a separate server-side schema; its five tables are not part of the mobile table count.
The roadmap count is corrected to 19. Admin/client interoperability is through the service
API contract, not shared WatermelonDB schema artifacts. No twentieth client table is
introduced, and the three approved converter tables are not removed.

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
| Q22 | Wallet lives on the Runner device | ✅ A |

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
reversed, or superseded. The updated ADR files and this mapping preserve traceability; all
future in-repository references use the new IDs. The new ADRs 0028–0032 will be added in
subsequent, separately reviewed directive commits.
