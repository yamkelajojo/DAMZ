# DAMZ — Refinement Session (grill-with-docs)

**Started**: 2026-10-04
**Method**: `grill-with-docs` (grilling + domain-modeling). Decisions are worked as a
design tree in rounds. Each round asks the whole **frontier** — the questions whose
prerequisites are already settled. This file is updated after every answer.

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
| C6 | Message retention | 90 days | **30 days** | — |
| C7 | Cancellation | only **before payment** | "**Any → cancelled**" | — |
| C8 | Catalog domain | 7 grocery items | — | titled "Medicine & Herb" |
| C9 | Customer strikes | Local on device; admin issues via dashboard | — | local-only can't receive admin strike |
| C10 | Proof key derivation | HKDF with an undefined `masterKey` IKM | — | Both derive "from the order ID" |
| C11 | Runner delivery address | customer row has address; **runner row has none** | — | Runner must reach the address |
| C12 | Walk-away bug | `unsafeResetDatabase()` used where `VACUUM` intended — wipes the DB | — | — |

---

## Round 1 — Foundation — ANSWERED

### Q1 — What is DAMZ selling in v1? → **A. Fixed 7-item grocery basket**

Confirmed: the seven items (Cabbage, Spinach, Cinnamon, Cauliflower, Rock Salt, Flour,
Bicarbonate of Soda) are the real v1 catalog. Medicine & herbs are a later concern.
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

## Round 2 — Admin scope, payment seam, lifecycle

**➡️ Recommendations below; answer by number.**

### Q7 — What exactly lives on the admin service?

Q2 established the server exists. Now scope its data. Candidates: runner registry,
strikes, disputes, platform settings, ban list, runner approval. Order/chat data is
excluded by ADR-0001.

- **A. Registry + ban list only.** Minimal: approve/ban runners.
- **B. Registry + ban list + disputes + strikes + settings** (everything admin-side
  except order/chat content).
- **C. A + disputes** (registry, bans, disputes), no strikes/settings.

**➡️ Recommendation: B**, but with disputes holding *only* the evidence the customer
chooses to share (proof CID + order ID), never auto-synced order data.

**Answer:** _[ ]_

### Q8 — What is the concrete "prepared for Monero" contract?

Q4 says mock now, real later. Define the seam now so it is easy to swap.

- **A. A `PaymentProvider` interface** with `requestPayment(order) → {subaddress, amount, expiresAt}`
  and `checkStatus(order) → 'pending'|'confirmed'|'expired'`; v1 ships `MockPaymentProvider`,
  v2 ships `MoneroPayProvider`.
- **B. Just keep the schema fields** (`monero_subaddress`, `payment_txid`) with no interface.
- **C. Interface + feature flag + a `payment_events` audit table** so status history is recorded.

**➡️ Recommendation: C.** The interface is the cheap part; the audit table is what
makes the later swap debuggable. Mock provider returns deterministic fake data.

**Answer:** _[ ]_

### Q9 — Retention windows (resolves C6)

`DB_LAYOUT` says orders/messages 90 days; `DB_ARC` says messages 30 days. Pick one.

- **A. Orders 90d, messages 30d** (as `DB_ARC`).
- **B. Orders 90d, messages 90d** (as `DB_LAYOUT`).
- **C. Orders 30d, messages 30d** — aggressive minimum retention.

**➡️ Recommendation: C for messages, and 90d for the order record only if a dispute
may still be open.** Simplest defensible rule: messages purge **30 days** after order
completion; order rows purge **90 days**; anything under an open dispute is frozen
until resolved. Ships the principle of data minimization.

**Answer:** _[ ]_

### Q10 — Cancellation semantics (resolves C7)

`DB_LAYOUT`: cancel only before payment. `DB_ARC`: "any → cancelled".

- **A. Before payment only** — after `paid`, the only exit is a dispute/refund path.
- **B. Any state → `cancelled`** — parties can always abandon.
- **C. Split: customer may cancel until `accepted`; after that, only a dispute.**

**➡️ Recommendation: C.** Once a runner has accepted and is travelling, unilateral
cancellation is abuse. Freezing it at `accepted` matches the strike model's intent.

**Answer:** _[ ]_

### Q11 — Customer strikes model (resolves C9)

`DB_LAYOUT` puts strikes locally on the customer device and also lets the admin issue
them — a local-only table cannot receive an admin action.

- **A. Server-authoritative.** Strikes live only on the admin service; devices pull
  their own strikes. 3 strikes = ban.
- **B. Local only.** The device records its own; no cross-device meaning.
- **C. Server-authoritative + local cache** for offline display.

**➡️ Recommendation: A.** Strikes are a moderation control, so they must be
authoritative somewhere the customer cannot edit. Since the admin service exists
(ADR-0001), put them there and have devices fetch on launch.

**Answer:** _[ ]_

### Q12 — Proof-bundle key derivation (resolves C10)

`DB_LAYOUT` derives the AES key from the order ID "via HKDF" but never defines the IKM
(`masterKey`). The spec claims both parties derive it from the order ID alone — which
would mean the order ID *is* the secret, and order IDs aren't secret.

- **A. Per-order random key**, generated by the runner, sent to the customer over the
  encrypted Signal channel (key never touches IPFS/relay).
- **B. HKDF from a shared Signal-session secret** (both sides already share it).
- **C. Hash of order ID** (as literally written) — weakest, effectively no protection.

**➡️ Recommendation: A.** Generate a fresh AES-256 key per proof bundle, send it in
the E2E channel, and store it only in the order row. The order ID is an identifier,
not a secret. This also makes dispute-sharing explicit (you hand over the key).

**Answer:** _[ ]_

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
| Q7 | Admin service data scope | ⏳ open |
| Q8 | Payment provider seam | ⏳ open |
| Q9 | Retention windows | ⏳ open |
| Q10 | Cancellation semantics | ⏳ open |
| Q11 | Customer strikes model | ⏳ open |
| Q12 | Proof-bundle key derivation | ⏳ open |

## ADRs created

- `docs/adr/0001-bounded-admin-service.md`
- `docs/adr/0002-did-key-identity.md`

## Glossary created

- `GLOSSARY.md`
