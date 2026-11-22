jest.mock(
  '@nozbe/watermelondb',
  () => ({
    appSchema: (definition: unknown) => definition,
    tableSchema: (definition: unknown) => definition,
  }),
  { virtual: true },
);

jest.mock(
  '@nozbe/watermelondb/Schema/migrations',
  () => ({
    schemaMigrations: ({ migrations }: { migrations: unknown[] }) => ({ migrations }),
    createTable: (table: unknown) => ({ operation: 'createTable', table }),
    addColumns: (step: unknown) => ({ operation: 'addColumns', step }),
    unsafeExecuteSql: (sql: string) => ({ operation: 'sql', sql }),
  }),
  { virtual: true },
);

import { migrations } from '../migrations';
import { schema } from '../schemas/schema';

type CreateTableStep = {
  operation: string;
  table: { name: string };
};
type VersionedMigration = {
  toVersion: number;
  steps: CreateTableStep[];
};

const versionedMigrations = (migrations as unknown as { migrations: VersionedMigration[] }).migrations;

describe('OQ-SCHEMA-001 / TC-DB-RETENTION-01 — additive migration history', () => {
  it('bumps the schema and creates exactly the three converter tables in v2', () => {
    expect((schema as { version: number }).version).toBe(3);
    expect(versionedMigrations).toHaveLength(2);
    expect(versionedMigrations[0].toVersion).toBe(2);
    expect(versionedMigrations[0].steps.map(({ table }) => table.name).sort()).toEqual([
      'exchange_offers',
      'swap_events',
      'swaps',
    ]);
  });

  it('uses only additive create-table steps and leaves existing tables untouched', () => {
    expect(versionedMigrations[0].steps.every(({ operation }) => operation === 'createTable')).toBe(true);
    expect(versionedMigrations[0].steps.map(({ table }) => table.name)).not.toContain('orders');
  });

  it('adds the swaps purge deadline in v3 without rewriting any table', () => {
    expect(versionedMigrations[1].toVersion).toBe(3);
    expect(versionedMigrations[1].steps.map(({ operation }) => operation)).toEqual([
      'addColumns',
      'sql',
    ]);
    expect(versionedMigrations[1].steps.every(({ operation }) => operation !== 'createTable')).toBe(
      true,
    );
  });
});
