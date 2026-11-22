jest.mock(
  '@nozbe/watermelondb',
  () => ({
    // Keep the real schema/Q/Model implementations; only the Database
    // constructor is replaced with the fake returned by makeContext().
    ...jest.requireActual('@nozbe/watermelondb'),
    Database: jest.fn(),
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

// expo-sqlite ships ESM and needs a native runtime, so it is replaced with a
// fake database. The factory is self-contained: `jest.mock` calls are hoisted
// above module-scope constants, but function declarations are hoisted too.
jest.mock(
  'expo-sqlite',
  () => ({
    __esModule: true,
    openDatabaseAsync: jest.fn(async () => createFakeSqliteDatabase(0)),
  }),
  { virtual: true },
);

import { closeDatabases, seedCatalogItems } from '../index';

const sqLite = jest.requireMock('expo-sqlite') as { openDatabaseAsync: jest.Mock };
const watermelondb = require('@nozbe/watermelondb') as { Database: jest.Mock };
const secureStore = require('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
};

type FakeSqliteDatabase = {
  execAsync: jest.Mock;
  runAsync: jest.Mock;
  getFirstAsync: jest.Mock;
  closeAsync: jest.Mock;
};

/** 32 random bytes, hex-encoded — the shape `getDatabaseKey()` produces. */
const TEST_DB_KEY = 'a'.repeat(64);

function createFakeSqliteDatabase(
  userVersion: number,
  { sqlcipher = true }: { sqlcipher?: boolean } = {},
): FakeSqliteDatabase {
  return {
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => undefined),
    getFirstAsync: jest.fn(async (sql: string) => {
      if (/cipher_version/i.test(sql)) {
        return sqlcipher ? { cipher_version: '4.7.0 community' } : {};
      }
      if (/user_version/i.test(sql)) return { user_version: userVersion };
      if (/sqlite_master/i.test(sql)) return { n: 1 };
      return null;
    }),
    closeAsync: jest.fn(async () => undefined),
  };
}

async function lastOpenedSqliteDatabase(): Promise<FakeSqliteDatabase> {
  const results = sqLite.openDatabaseAsync.mock.results;
  // `mock.results[].value` holds the promise returned by the async mock.
  return (await results[results.length - 1].value) as FakeSqliteDatabase;
}

function executedSql(db: FakeSqliteDatabase): string {
  return db.execAsync.mock.calls.map((call: unknown[]) => call[0]).join('\n');
}

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
    adapter: {
      underlyingAdapter: { close: jest.Mock; unsafeExecute: jest.Mock };
    };
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
  const underlyingAdapter = {
    close: jest.fn(async () => undefined),
    unsafeExecute: jest.fn(
      (_work: unknown, callback: (result: { value?: void }) => void) =>
        callback({ value: undefined }),
    ),
  };
  const db = {
    get: jest.fn(() => catalogCollection),
    write: jest.fn(async (callback: () => Promise<void>) => callback()),
    adapter: { underlyingAdapter },
  };

  return { rows, create, db };
}

beforeEach(async () => {
  await closeDatabases();
  jest.clearAllMocks();
  context = makeContext();
  watermelondb.Database.mockImplementation(() => context.db);
  secureStore.getItemAsync.mockResolvedValue(TEST_DB_KEY);
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

  it('seeds reference rows only; it does not create prices or a delivery-fee row', async () => {
    await seedCatalogItems('customer');

    expect(context.db.get).toHaveBeenCalledTimes(1);
    expect(context.db.get).toHaveBeenCalledWith('catalog_items');
  });
});

describe('TC-DB-SETUP — SQLCipher schema provisioning', () => {
  it('applies the SQLCipher key and creates the current schema', async () => {
    await seedCatalogItems('customer');

    // expo-sqlite is opened without a `key` option: it is not part of
    // SQLiteOpenOptions, so the native layer silently ignores it.
    expect(sqLite.openDatabaseAsync).toHaveBeenCalledWith('damz.db');

    const db = await lastOpenedSqliteDatabase();
    const sql = executedSql(db);

    expect(sql).toContain(`PRAGMA key = "x'${TEST_DB_KEY}'"`);
    expect(sql).toContain('create table "catalog_items"');
    expect(sql).toContain('create table "orders"');
    expect(sql).toContain('create table "local_storage"');
    expect(sql).toContain('PRAGMA user_version = 3');

    // The key must be applied before the schema is touched, otherwise SQLCipher
    // refuses to key the already-read file.
    expect(sql.indexOf('PRAGMA key')).toBeLessThan(sql.indexOf('create table'));
  });

  it('refuses to open the database when SQLCipher is not compiled in', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sqLite.openDatabaseAsync.mockImplementationOnce(async () =>
      createFakeSqliteDatabase(0, { sqlcipher: false }),
    );

    await expect(seedCatalogItems('customer')).rejects.toThrow(/SQLCipher is not available/);

    consoleError.mockRestore();
  });

  it('refuses a malformed key instead of opening a plaintext database', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    secureStore.getItemAsync.mockResolvedValueOnce('not-a-64-hex-key');

    await expect(seedCatalogItems('customer')).rejects.toThrow(/64-character hex/);

    consoleError.mockRestore();
  });

  it('replays every migration step for an existing v1 database', async () => {
    sqLite.openDatabaseAsync.mockImplementationOnce(async () => createFakeSqliteDatabase(1));

    await seedCatalogItems('customer');

    const sql = executedSql(await lastOpenedSqliteDatabase());
    expect(sql).toContain('create table "swaps"');
    expect(sql).toContain('create table "exchange_offers"');
    expect(sql).toContain('create table "swap_events"');
    expect(sql).toContain('PRAGMA user_version = 3');
    // A migration must only apply the delta, never rebuild the whole schema.
    expect(sql).not.toContain('create table "orders"');

    // v1 → v3 crosses two versions, so the v3 step must run as well.
    expect(sql).toContain('alter table "swaps" add "purge_after"');

    // The v2 create-table step is a frozen snapshot, so it must not already
    // contain the column v3 adds — otherwise the `alter table` above fails with
    // a duplicate-column error on every v1 database.
    const swapsCreateStart = sql.indexOf('create table "swaps"');
    const swapsCreate = sql.slice(swapsCreateStart, sql.indexOf(';', swapsCreateStart));
    expect(swapsCreate).not.toContain('purge_after');
    expect(swapsCreateStart).toBeLessThan(sql.indexOf('alter table "swaps" add "purge_after"'));
  });

  it('rejects a database that is newer than the app schema', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sqLite.openDatabaseAsync.mockImplementationOnce(async () => createFakeSqliteDatabase(99));

    await expect(seedCatalogItems('customer')).rejects.toThrow(
      /newer than the app schema version 3/,
    );

    consoleError.mockRestore();
  });
});
