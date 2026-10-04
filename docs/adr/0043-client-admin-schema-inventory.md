# ADR-0043: Reconcile the Client and Admin Schema Inventories

**Status**: Accepted
**Date**: 2026-10-04
**Owner**: Admin/Developer

## Context

The approved v2 database layout and the ownership contract enumerate 19 client-side
WatermelonDB tables. The checked-in WatermelonDB schema, models, and shared Zod types
currently describe 16 of them; the three converter tables (`swaps`, `exchange_offers`,
and `swap_events`) are absent from those implementation artifacts. `ROADMAP.md` instead
claims the client schema has 20 tables, but no twentieth client table is defined in v2.

The Admin service has a separate Rust/SQLite schema described in
`services/admin/SPEC.md` and `DB_LAYOUT_AND_ARCH.md` §8. Its five current server-side
tables are not part of the mobile WatermelonDB install sets. This boundary is consistent
with ADR-0007, which specifies a separate API contract for the Rust service, but conflicts
with the refinement-session wording that the Admin service reuses the client schema's type
definitions.

Finally, `packages/db/scripts/validate-schema.ts` searches the TypeScript WatermelonDB
schema source for SQL `CREATE TABLE` statements. The checked-in schema uses `Schema(...)`
and contains no such statements, so the validator does not inspect the declared schema.

## Decision

1. The canonical **client-side** schema is the 19-table inventory defined in §§2–4 of
   `DB_LAYOUT_AND_ARCH.md` and listed in `packages/db/OWNERSHIP_CONTRACT.md`:
   `identity`, `contacts`, `catalog_items`, `price_lists`, `runner_prices`, `swaps`,
   `exchange_offers`, `swap_events`, `orders`, `order_items`, `payment_events`,
   `messages`, `proof_bundles`, `wallet_metadata`, `strikes`, `runner_directory`,
   `platform_settings`, `disputes`, and `sync_state`.
2. The three documented converter tables remain part of v2 and must be brought into the
   client schema implementation. This records no new converter feature; it aligns the
   implementation with the already-approved v2 schema and ADR-0014.
3. The Admin service maintains a **separate server-side schema**. Its tables are not
   WatermelonDB tables and are excluded from the client-table count. Shared domain
   semantics are expressed through the service API contract, not by reusing the mobile
   WatermelonDB schema in the Rust service.
4. The roadmap's “20 tables” statement is corrected to “19 client-side tables.” No
   twentieth client table is approved by this ADR.
5. The schema validator must validate the actual TypeScript WatermelonDB schema and its
   declared table/column inventory; it must not treat an empty SQL-regex parse as success.
6. Schema implementation, migration, validator, and test changes follow the documentation
   review gate. This ADR records the target inventory; it does not claim those changes are
   already implemented.

## Alternatives Considered

- **Keep the 20-table count and invent or infer a twentieth client table** — rejected:
  v2 and the ownership contract define 19 client tables, and no additional client table
  has been approved.
- **Count Admin tables as part of the mobile schema** — rejected: Admin has a separate
  Rust/SQLite database and API contract; those tables are not installed on Customer or
  Runner devices.
- **Remove the three converter tables from the v2 inventory** — rejected: they are
  explicitly defined in the approved database layout and ownership contract and support
  the already-recorded converter decision.
- **Keep the current validator unchanged** — rejected: it cannot validate the
  TypeScript schema source as written and may miss missing tables.

## Consequences

- The client implementation is short three documented tables and requires a versioned,
  additive schema migration before the Phase 1 schema gate can pass.
- The Admin service remains outside the client schema package. Its current five tables,
  and any future Admin-only tables such as `wipe_pending` from the remote-wipe decision,
  do not increase the 19-table client inventory.
- Documentation, schema code, model/type definitions, migration logic, validator, and
  tests must be checked against the same 19-table inventory before implementation is
  considered ready.
- This decision does not change the anonymity model, table ownership, or bounded Admin
  service scope.

## Open Questions

- **OQ-SCHEMA-001**: Confirm the migration and upgrade path for adding the three existing
  v2 converter tables to the current WatermelonDB schema version. **Owner**: Admin/Developer.
  **Target resolution**: before schema implementation and its Phase 1 migration-test gate.
- **OQ-SCHEMA-002**: Choose and verify a validator implementation that inspects the actual
  WatermelonDB schema and fails when a required table or column is missing. **Owner**:
  Admin/Developer. **Target resolution**: before the Phase 1 schema-validation gate.
