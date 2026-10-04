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
`services/admin/SPEC.md` and `DB_LAYOUT_AND_ARCH.md` §8. Its five server-side
tables at the time of this inventory reconciliation were not part of the mobile
WatermelonDB install sets; ADR-0029 later adds the Admin-only `wipe_pending` table, still
outside the client schema. This boundary is consistent
with ADR-0007, which specifies a separate API contract for the Rust service, but conflicts
with the refinement-session wording that the Admin service reuses the client schema's type
definitions.

Finally, `packages/db/scripts/validate-schema.ts` searches the TypeScript WatermelonDB
schema source for SQL `CREATE TABLE` statements. The checked-in schema uses
`appSchema(...)` and contains no such statements, so the validator does not inspect the
declared schema.

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
   review gate. The v1-to-v2 migration path is resolved below; the implementation must pass
   the Phase 1 upgrade gate before release.

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
- **Split converter tables into a separate v3 migration** — rejected for this branch by
  the user-selected resolution of OQ-SCHEMA-001; the documented v2 catalog upgrade and
  converter-table additions will ship as one additive v1-to-v2 migration. Release must
  verify that no incompatible v2 migration has already shipped to supported devices.

## Resolution — OQ-SCHEMA-001 (2026-10-04)

**Owner**: Admin/Developer. **Status**: Resolved by user selection.

Use a single additive WatermelonDB migration from schema version 1 to version 2. Its
`schemaMigrations` steps create exactly `swaps`, `exchange_offers`, and `swap_events` from
the shared raw table-definition specs from which `appSchema` is built. The post-open
catalog initializer separately fills missing reference rows, including Grape Soda, so
partially seeded v1 databases are
upgraded without duplicate rows. The migration does not drop/recreate existing tables or
reset user data. The database package advances from 1.0.0 to 1.1.0 under the approved
additive-minor versioning rule. The Customer and Runner client schema remains separate from
the Admin service schema; no Admin table is included in the mobile migration.

The migration-registration unit test is required, and a device/database upgrade test from
an actual v1 SQLCipher database remains a Phase 1 release gate. If a v2 migration has
already shipped outside this checkout, implementation/release must stop and the migration
sequence be reassessed before deployment.

## Consequences

- Schema version 2 adds the three documented converter tables through one additive
  WatermelonDB migration; the catalog initializer backfills Grape Soda without overwriting
  existing rows. Existing v1 client data is preserved.
- The package semver follows the approved strategy's additive-minor rule (1.0.0 to 1.1.0).
- Release remains gated on a real v1-to-v2 device/database upgrade test; unit assertions of
  migration registration are not a substitute for that upgrade test.
- The Admin service remains outside the client schema package. Its separate six-table
  schema now includes Admin-only `wipe_pending` under ADR-0029; no Admin table increases
  the 19-table client inventory.
- Documentation, schema code, model/type definitions, migration logic, validator, and
  tests must be checked against the same 19-table inventory before the schema phase is
  considered complete.
- This schema-inventory decision does not change the anonymity model or table ownership.
  The Admin service's later narrow scope extension is recorded separately in ADR-0029 and
  still does not merge the Admin schema with the client schema.

## Open Questions

- **OQ-SCHEMA-002**: Choose and verify a validator implementation that inspects the actual
  WatermelonDB schema and fails when a required table or column is missing. **Owner**:
  Admin/Developer. **Target resolution**: before the Phase 1 schema-validation gate.
- **OQ-SCHEMA-003**: Confirm the canonical client SQLCipher adapter package, import, version,
  and supported options/API. The current source imports WatermelonDB's standard
  `SQLiteAdapter` while passing `cipherKey` and calling adapter methods not present in the
  0.27.0 public typings; the declared `@nozbe/watermelondbcipher@^0.27.0` returned HTTP 404
  from the public npm registry in this environment. Do not claim local database encryption
  or release the migration until this is resolved and verified against the native adapter.
  **Owner**: Admin/Developer. **Target resolution**: before the Phase 1 SQLCipher upgrade /
  release gate. Any adapter or storage-architecture replacement requires a separate ADR and
  user confirmation.
