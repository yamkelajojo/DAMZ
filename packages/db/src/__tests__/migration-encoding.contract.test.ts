/**
 * TC-DB-MIGRATION-01 — a v1 database upgrading to the current version must
 * produce real SQL.
 *
 * This suite deliberately uses WatermelonDB's real schema factories and its real
 * `encodeMigrationSteps`, because structural assertions on the migration object
 * cannot see what SQL it actually becomes.
 *
 * The trap it guards against: `encodeCreateTable` builds its column list with
 * `Object.keys(schema.columns)` and therefore needs the *map* that
 * `tableSchema()` returns, not the `columns` array stored in
 * `TABLE_SCHEMA_SPECS`. `createTable()` performs that normalisation internally,
 * so specs must be passed to it unconverted. A hand-built step of the form
 * `{ type: 'create_table', schema: { name, columns: [...array...] } }` encodes
 * to `create table "swaps" (... "0", "1")` — positional column names that
 * SQLite accepts silently.
 */

jest.mock('@nozbe/watermelondb', () => ({
  ...jest.requireActual('@nozbe/watermelondb'),
}));

import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';
import { encodeMigrationSteps } from '@nozbe/watermelondb/adapters/sqlite/encodeSchema';
import { migrations } from '../migrations';
import { schema } from '../schemas/schema';

const EXPECTED_V2_COLUMNS: Record<string, string[]> = {
  swaps: [
    'persona',
    'direction',
    'status',
    'btc_amount_sat',
    'btc_address',
    'btc_txid',
    'btc_refund_txid',
    'xmr_amount_pico',
    'xmr_subaddress',
    'xmr_txid',
    'zar_amount_cents',
    'zar_reference',
    'created_at',
    'expires_at',
    'completed_at',
    'network_fee_btc',
    'network_fee_xmr',
    'service_fee_zar',
  ],
  exchange_offers: [
    'source',
    'direction',
    'price_zar_per_xmr',
    'min_amount',
    'max_amount',
    'payment_method',
    'trader_rating',
    'fetched_at',
    'expires_at',
  ],
  swap_events: ['swap_id', 'kind', 'observed_at', 'detail'],
};

const steps = stepsForMigration({ migrations, fromVersion: 1, toVersion: schema.version });
const upgradeSql = encodeMigrationSteps(steps ?? []);

describe('TC-DB-MIGRATION-01 — v1 to v3 upgrade SQL', () => {
  it('resolves the real migration steps for a v1 database', () => {
    expect(schema.version).toBe(3);
    expect(steps).not.toBeNull();
    // 3 create-table steps (v2) + addColumns + backfill (v3).
    expect(steps).toHaveLength(5);
  });

  it('creates each converter table with its real column names', () => {
    for (const [table, columns] of Object.entries(EXPECTED_V2_COLUMNS)) {
      expect(upgradeSql).toContain(`create table "${table}"`);
      for (const column of columns) {
        expect(upgradeSql).toContain(`"${column}"`);
      }
    }
  });

  it('does not add the v3 column during the v2 create-table step', () => {
    // `alter table` in v3 would fail with "duplicate column name" if the v2 step
    // pulled its columns from the live schema instead of a frozen snapshot.
    const createStart = upgradeSql.indexOf('create table "swaps"');
    const createStatement = upgradeSql.slice(createStart, upgradeSql.indexOf(';', createStart));
    expect(createStatement).not.toContain('purge_after');
  });

  it('adds swaps.purge_after and backfills completed swaps in v3', () => {
    expect(upgradeSql).toContain('alter table "swaps" add "purge_after"');
    // WatermelonDB sets the new column to its null value on every existing row.
    expect(upgradeSql).toContain('update "swaps" set "purge_after" = null');
    // The backfill gives swaps that already completed a real 90-day deadline
    // (90 * 24 * 60 * 60 * 1000 ms).
    expect(upgradeSql).toContain(
      'update "swaps" set "purge_after" = "completed_at" + 7776000000 where "completed_at" is not null',
    );
  });

  it('is idempotent-safe: the v3 column is added exactly once', () => {
    const alterations = upgradeSql.match(/alter table "swaps" add "purge_after"/g) ?? [];
    expect(alterations).toHaveLength(1);
  });

  it('never emits positional column names', () => {
    // Guards against a hand-built `create_table` step that skips the
    // `createTable()` normalisation described above.
    expect(upgradeSql).not.toMatch(/"\d+"/);
  });

  it('recreates the indexes declared on the new columns', () => {
    expect(upgradeSql).toContain('create index if not exists "exchange_offers_source"');
    expect(upgradeSql).toContain('create index if not exists "swap_events_swap_id"');
    expect(upgradeSql).toContain('create index if not exists "swaps__status"');
  });

  it('leaves the pre-existing v1 tables untouched', () => {
    for (const v1Table of ['orders', 'catalog_items', 'identity', 'messages']) {
      expect(upgradeSql).not.toContain(`create table "${v1Table}"`);
    }
  });
});
