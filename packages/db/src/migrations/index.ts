import { createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';
import { TABLE_SCHEMA_SPECS } from '../schemas/schema';

const VERSION_2_TABLE_NAMES = new Set(['swaps', 'exchange_offers', 'swap_events']);
const versionTwoTables = TABLE_SCHEMA_SPECS.filter((table) => VERSION_2_TABLE_NAMES.has(table.name));

if (versionTwoTables.length !== VERSION_2_TABLE_NAMES.size) {
  throw new Error('Schema migration v2 must create exactly the three converter tables');
}

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: versionTwoTables.map((table) => createTable(table)),
    },
  ],
});
