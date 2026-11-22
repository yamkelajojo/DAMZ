import {
  addColumns,
  createTable,
  schemaMigrations,
  unsafeExecuteSql,
} from '@nozbe/watermelondb/Schema/migrations';
import { V2_TABLE_SPECS } from './v2-tables';

/** 90 days, matching the retention window for orders (`DB_LAYOUT_AND_ARCH.md` §6). */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

if (V2_TABLE_SPECS.map((table) => table.name).join(',') !== 'swaps,exchange_offers,swap_events') {
  throw new Error('Schema migration v2 must create exactly the three converter tables');
}

// `TABLE_SCHEMA_SPECS` stores columns as an array; `createTable` normalises the
// spec through `tableSchema()` itself (WatermelonDB's `createTable` calls
// `tableSchema(tableSchemaSpec)`), which is what turns the array into the column
// map `encodeCreateTable` expects. Do not pre-convert here — passing an
// already-normalised schema back into `tableSchema` fails, because it expects
// the `columns` array (`tableSchema({ columns: columnArray })`).
//
// The v2 steps use the frozen snapshot in `v2-tables.ts`, not the live schema:
// see that file for why reading the live schema breaks later upgrades.
export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: V2_TABLE_SPECS.map((table) => createTable(table)),
    },
    {
      toVersion: 3,
      steps: [
        // `addColumns` sets the new column to its null value on every existing
        // row, so the backfill below is what gives already-completed swaps a real
        // deadline. Without it those rows would never be purged.
        addColumns({
          table: 'swaps',
          columns: [{ name: 'purge_after', type: 'number', isOptional: true }],
        }),
        unsafeExecuteSql(
          `update "swaps" set "purge_after" = "completed_at" + ${NINETY_DAYS_MS} ` +
            'where "completed_at" is not null;',
        ),
      ],
    },
  ],
});
