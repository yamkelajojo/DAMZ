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

describe('OQ-SCHEMA-001 resolution — additive v1-to-v2 migration', () => {
  it('bumps the schema and creates exactly the three converter tables', () => {
    expect((schema as { version: number }).version).toBe(2);
    expect(versionedMigrations).toHaveLength(1);
    expect(versionedMigrations[0].toVersion).toBe(2);
    expect(versionedMigrations[0].steps.map(({ table }) => table.name).sort()).toEqual([
      'exchange_offers',
      'swap_events',
      'swaps',
    ]);
  });

  it('uses only additive create-table steps and leaves existing tables untouched', () => {
    expect(versionedMigrations[0].steps.every(({ operation }) => operation === 'createTable')).toBe(true);
  });
});
