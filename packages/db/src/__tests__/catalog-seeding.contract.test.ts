jest.mock(
  '@nozbe/watermelondb',
  () => ({
    appSchema: (definition: unknown) => definition,
    tableSchema: (definition: unknown) => definition,
    Database: jest.fn(),
  }),
  { virtual: true },
);

jest.mock(
  '@nozbe/watermelondb/adapters/sqlite',
  () => ({ __esModule: true, default: jest.fn() }),
  { virtual: true },
);

jest.mock(
  '@nozbe/watermelondb/Schema/migrations',
  () => ({
    schemaMigrations: ({ migrations }: { migrations: unknown[] }) => ({ migrations }),
    createTable: (table: unknown) => table,
  }),
  { virtual: true },
);

jest.mock(
  '../models',
  () => ({
    CUSTOMER_MODELS: [],
    RUNNER_MODELS: [],
    MODELS: [],
    TABLES: {
      CATALOG_ITEMS: 'catalog_items',
      ORDERS: 'orders',
    },
  }),
);

jest.mock(
  'expo-secure-store',
  () => ({
    __esModule: true,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
  }),
  { virtual: true },
);

jest.mock(
  'expo-crypto',
  () => ({
    __esModule: true,
    getRandomBytesAsync: jest.fn(),
  }),
  { virtual: true },
);

import { closeDatabases, seedCatalogItems } from '../index';

const watermelondb = require('@nozbe/watermelondb') as {
  Database: jest.Mock;
};
const sqliteAdapter = require('@nozbe/watermelondb/adapters/sqlite').default as jest.Mock;
const secureStore = require('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
};

type SeededRow = {
  id: string;
  displayName: string;
  sortOrder: number;
};

type TestContext = {
  rows: SeededRow[];
  create: jest.Mock;
  db: {
    get: jest.Mock;
    write: jest.Mock;
    adapter: { close: jest.Mock; unsafeSqlQuery: jest.Mock };
  };
};

let context: TestContext;

function makeContext(): TestContext {
  const rows: SeededRow[] = [];
  const create = jest.fn(async (buildRecord: (record: any) => void) => {
    const record = { _raw: { id: '' }, displayName: '', sortOrder: 0 };
    buildRecord(record);
    rows.push({
      id: record._raw.id,
      displayName: record.displayName,
      sortOrder: record.sortOrder,
    });
    return record;
  });
  const catalogCollection = {
    query: jest.fn(() => ({ fetch: jest.fn(async () => rows) })),
    create,
  };
  const adapter = {
    close: jest.fn(),
    unsafeSqlQuery: jest.fn(async () => undefined),
  };
  const db = {
    get: jest.fn(() => catalogCollection),
    write: jest.fn(async (callback: () => Promise<void>) => callback()),
    adapter,
  };

  return { rows, create, db };
}

beforeEach(async () => {
  await closeDatabases();
  jest.clearAllMocks();
  context = makeContext();
  watermelondb.Database.mockImplementation(() => context.db);
  sqliteAdapter.mockImplementation(() => context.db.adapter);
  secureStore.getItemAsync.mockResolvedValue('test-only-database-key');
  secureStore.setItemAsync.mockResolvedValue(undefined);
});

afterEach(async () => {
  await closeDatabases();
});

describe('TC-CAT-01 — catalog seeding in each client app', () => {
  it.each(['customer', 'runner'] as const)('seeds the agreed eight items for %s', async (persona) => {
    await seedCatalogItems(persona);

    expect(context.rows.map(({ id }) => id)).toEqual([
      'cabbage',
      'spinach',
      'cinnamon',
      'cauliflower',
      'rock_salt',
      'flour',
      'bicarbonate_of_soda',
      'grape_soda',
    ]);
    expect(context.rows.find(({ id }) => id === 'grape_soda')).toEqual({
      id: 'grape_soda',
      displayName: 'Grape Soda (Small Bottle)',
      sortOrder: 8,
    });
  });

  it('adds Grape Soda exactly once as a reference row with the agreed label and order', async () => {
    await seedCatalogItems('customer');

    expect(context.rows.filter(({ id }) => id === 'grape_soda')).toEqual([
      {
        id: 'grape_soda',
        displayName: 'Grape Soda (Small Bottle)',
        sortOrder: 8,
      },
    ]);
  });

  it('repairs an existing seven-item catalog without duplicating its existing references', async () => {
    context.rows.push(
      { id: 'cabbage', displayName: 'Cabbage', sortOrder: 1 },
      { id: 'spinach', displayName: 'Spinach', sortOrder: 2 },
      { id: 'cinnamon', displayName: 'Cinnamon', sortOrder: 3 },
      { id: 'cauliflower', displayName: 'Cauliflower', sortOrder: 4 },
      { id: 'rock_salt', displayName: 'Rock Salt', sortOrder: 5 },
      { id: 'flour', displayName: 'Flour', sortOrder: 6 },
      { id: 'bicarbonate_of_soda', displayName: 'Bicarbonate of Soda', sortOrder: 7 },
    );

    await seedCatalogItems('customer');

    expect(context.rows).toHaveLength(8);
    expect(context.rows.filter(({ id }) => id === 'grape_soda')).toEqual([
      { id: 'grape_soda', displayName: 'Grape Soda (Small Bottle)', sortOrder: 8 },
    ]);
    expect(context.create).toHaveBeenCalledTimes(1);
  });

  it('does not create duplicate catalog rows when initialization is repeated', async () => {
    await seedCatalogItems('customer');
    const seededCount = context.rows.length;

    await seedCatalogItems('customer');

    expect(context.rows).toHaveLength(seededCount);
    expect(context.create).toHaveBeenCalledTimes(seededCount);
  });

  it('registers schema v2 migrations on the SQLCipher adapter', async () => {
    await seedCatalogItems('customer');

    const adapterOptions = sqliteAdapter.mock.calls[0][0];
    expect(adapterOptions.schema.version).toBe(2);
    expect(adapterOptions.migrations.migrations[0].toVersion).toBe(2);
    expect(adapterOptions.cipherKey).toBe('test-only-database-key');
  });

  it('seeds reference rows only; it does not create prices or a delivery-fee row', async () => {
    await seedCatalogItems('customer');

    expect(context.db.get).toHaveBeenCalledTimes(1);
    expect(context.db.get).toHaveBeenCalledWith('catalog_items');
  });
});
