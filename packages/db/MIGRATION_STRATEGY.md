# Database Migration Strategy

**Version**: 1.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

---

## 1. Versioning Scheme

### 1.1 Schema Package Version
- `packages/db/package.json` version = schema version (e.g., `1.0.0`, `1.1.0`, `2.0.0`)
- SemVer: MAJOR = breaking migration, MINOR = additive migration, PATCH = bugfix
- Published to npm registry (or GitHub Packages) on every merge to main

### 1.2 Migration Version (WatermelonDB)
- Each migration gets a sequential integer version: `1`, `2`, `3`...
- Stored in WatermelonDB's `schema_migrations` table
- App tracks `schema_version` in `platform_settings` for sync compatibility

### 1.3 Admin Service Migration Version
- `sqlx` migration files: `migrations/0001_initial.sql`, `0002_add_ban_reason.sql`...
- Applied on startup via `sqlx::migrate!()`
- Version tracked in `schema_version` table (single row)

---

## 2. WatermelonDB Migrations (Mobile Apps)

### 2.1 Migration Structure
WatermelonDB migrations are registered with `schemaMigrations` and passed to the SQLite
adapter. The adapter applies declared additive steps when opening a database created with an
older schema version. Migration steps must preserve existing rows; production migrations do
not drop or recreate the user's database.

```typescript
// packages/db/src/migrations/index.ts
import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({ migrations: [] });
```

### 2.2 Additive Migration (MINOR version)
The approved v1-to-v2 upgrade combines the already documented Grape Soda catalog
backfill with the three existing converter tables. `schema.ts` is the source of truth for
new table definitions; the WatermelonDB migration creates those tables additively, and the
post-open catalog initializer idempotently fills missing reference rows, including Grape
Soda.

```typescript
// packages/db/src/migrations/index.ts
import { createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';
import { TABLE_SCHEMA_SPECS } from '../schemas/schema';

const v2TableNames = new Set(['swaps', 'exchange_offers', 'swap_events']);
const v2Tables = TABLE_SCHEMA_SPECS.filter((table) => v2TableNames.has(table.name));

export const migrations = schemaMigrations({
  migrations: [{ toVersion: 2, steps: v2Tables.map((table) => createTable(table)) }],
});
```

The catalog backfill adds only the eighth reference item. It creates no Runner price or
delivery-fee value. The Runner editor's R15.00 Grape Soda and R20.00 delivery-fee prefills
are editable UI suggestions under ADR-0004/C20, not database defaults or minimums. No
schema or data migration is needed for those suggestions.

### 2.3 Breaking Migration (MAJOR version)
- Requires full app reinstall (user wipes data)
- Document in `CHANGELOG.md` with migration guide
- Bump `packages/db` major version

### 2.4 Migration Registration
```typescript
// packages/db/src/index.ts
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { migrations } from './migrations';
import { schema } from './schemas/schema';

const adapter = new SQLiteAdapter({ schema, migrations, dbName: 'damz.db' });
```

### 2.5 On-Device Migration Execution
WatermelonDB applies the registered migration steps as part of adapter setup when the
existing database version is older than the declared schema. After the adapter opens, the
normal idempotent catalog initializer fills missing reference items. No `unsafeResetDatabase`
or destructive fallback is allowed for this additive upgrade.

---

## 3. Admin Service Migrations (Server)

### 3.1 Migration Files
```
services/admin/
├── migrations/
│   ├── 0001_initial.sql
│   ├── 0002_add_ban_reason.sql
│   └── 0003_add_dispute_proof_key.sql
├── src/
│   └── migrations.rs
└── Cargo.toml
```

### 3.2 sqlx Integration
```rust
// services/admin/src/migrations.rs
use sqlx::sqlite::SqlitePool;
use sqlx::migrate::Migrator;

static MIGRATOR: Migrator = sqlx::migrate!("migrations");

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    MIGRATOR.run(pool).await
}
```

### 3.2 Startup Hook
```rust
// main.rs
#[tokio::main]
async fn main() {
    let pool = SqlitePool::connect(&db_url).await?;
    
    // 1. Run migrations
    run_migrations(&pool).await?;
    
    // 2. Enforce bounded scope
    enforce_bounded_scope(&pool).await?;
    
    // 3. Start server
    // ...
}
```

### 3.3 Deployment
- Migrations run automatically on container startup
- Zero-downtime: migrations are additive-only (no DROP COLUMN in production)
- Rollback: manual SQL if needed (documented in `DEPLOYMENT.md`)

---

## 4. Schema Package Publishing

### 4.1 Version Bump Process
```bash
# In packages/db/
# 1. Add migration file
# 2. Update package.json version
# 3. Run tests
bun test

# 4. Publish
bun publish --access public
```

### 4.2 Consumer Updates
```bash
# In apps/customer, apps/runner, apps/converter
bun add @damz/db@latest
```

### 4.3 CI Gate
- `packages/db` publish workflow runs on version change
- Consumer apps test against latest `@damz/db` in CI

---

## 5. Migration Testing

### 5.1 Local Testing
```bash
# Test migration from v1 to v2 on device
# 1. Install v1 app
# 2. Create data
# 3. Upgrade to v2
# 4. Verify data integrity + new features work
```

### 5.2 CI Testing
```yaml
# .github/workflows/db-migrations.yml
jobs:
  test-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test WatermelonDB migrations
        run: |
          cd packages/db
          bun test:migrations  # Runs through all migrations on fresh DB
      - name: Test sqlx migrations
        run: |
          cd services/admin
          cargo test --test migrations
```

### 5.3 Migration Test Cases
- Fresh install → latest schema
- v1 data → v2 migration (data integrity)
- v1 data → v3 migration (skip v2)
- Migration rollback (down) for development
- Schema validation script passes after each migration

---

## 6. Rollback Strategy

### 6.1 Mobile Apps
- **No automatic rollback**: Down migrations not tested in production
- **User recourse**: Uninstall/reinstall (data loss = last resort)
- **Prevention**: All migrations additive-only in production

### 6.2 Admin Service
- **Manual rollback**: Documented SQL scripts in `migrations/rollback/`
- **Backup before deploy**: Daily encrypted SQLite backup (see Admin SPEC §7.5)
- **Point-in-time recovery**: Restore backup + replay WAL

---

## 7. Open Questions

- **OQ-MIG-001**: Should we support background migration for large tables (e.g., adding index to `messages`)? Current: all v1 tables small enough for instant migration.
- **OQ-MIG-002**: Cross-app migration sync — if Customer on v2, Runner on v1, how to handle? Current: version negotiation in sync protocol (ADR-0016).
- **OQ-MIG-003**: Admin service migration during dispute resolution — pause disputes? Current: migrations additive-only, no pause needed.