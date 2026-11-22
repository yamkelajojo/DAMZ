/**
 * TC-ADAPTER-01 — ExpoSQLiteAdapter data path.
 *
 * This suite drives the adapter with WatermelonDB's *real* SQL encoders
 * (`encodeQuery`, `encodeBatch`, `sanitizeFindResult`, …) and a fake
 * expo-sqlite connection. Only `@nozbe/watermelondb`'s schema factories and
 * `expo-sqlite` are mocked; everything that turns a query into SQL is the
 * library's own code.
 *
 * The previous implementation could not pass these tests: it compiled normal
 * queries to an empty string, dropped `id` from every INSERT (so writes failed
 * their NOT NULL constraint) and returned unsanitized rows.
 */

jest.mock(
  '@nozbe/watermelondb',
  () => ({
    appSchema: ({ version, tables }: { version: number; tables: any[] }) => ({
      version,
      tables: Object.fromEntries(
        tables.map((table) => [
          table.name,
          {
            name: table.name,
            columns: Object.fromEntries(table.columns.map((column: any) => [column.name, column])),
            columnArray: table.columns,
          },
        ]),
      ),
    }),
    tableSchema: ({ name, columns }: { name: string; columns: any[] }) => ({
      name,
      columns,
      columnArray: columns,
    }),
  }),
  { virtual: true },
);

jest.mock(
  'expo-sqlite',
  () => ({
    __esModule: true,
    openDatabaseAsync: jest.fn(),
  }),
  { virtual: true },
);

import { ExpoSQLiteAdapter } from '../adapters/ExpoSQLiteAdapter';
import {
  schemaMigrations,
  unsafeExecuteSql,
} from '@nozbe/watermelondb/Schema/migrations';

const watermelondb = jest.requireMock('@nozbe/watermelondb') as {
  appSchema: (options: { version: number; tables: any[] }) => any;
  tableSchema: (options: { name: string; columns: any[] }) => any;
};
const sqLite = jest.requireMock('expo-sqlite') as { openDatabaseAsync: jest.Mock };

const TEST_DB_KEY = 'a'.repeat(64);

type FakeSqlite = {
  execAsync: jest.Mock;
  runAsync: jest.Mock;
  getAllAsync: jest.Mock;
  getFirstAsync: jest.Mock;
  withTransactionAsync: jest.Mock;
  closeAsync: jest.Mock;
};

function createFakeSqlite({
  userVersion = 0,
  sqlcipher = true,
}: { userVersion?: number; sqlcipher?: boolean } = {}): FakeSqlite {
  return {
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async (sql: string) => {
      if (/cipher_version/i.test(sql)) {
        return sqlcipher ? { cipher_version: '4.7.0 community' } : {};
      }
      if (/user_version/i.test(sql)) return { user_version: userVersion };
      if (/sqlite_master/i.test(sql)) return { n: 1 };
      return null;
    }),
    withTransactionAsync: jest.fn(async (work: () => Promise<void>) => {
      await work();
    }),
    closeAsync: jest.fn(async () => undefined),
  };
}

const schema = watermelondb.appSchema({
  version: 1,
  tables: [
    watermelondb.tableSchema({
      name: 'catalog_items',
      columns: [
        { name: 'display_name', type: 'string' },
        { name: 'sort_order', type: 'number' },
      ],
    }),
  ],
});

/** A query as WatermelonDB serializes it: `table` + `description` + joins. */
function makeQuery(description: Record<string, unknown> = {}): any {
  return {
    table: 'catalog_items',
    description: { where: [], sortBy: [], ...description },
    associations: [],
  };
}

function call<T>(
  invoke: (callback: (result: { value?: T; error?: Error }) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((result) => (result.error ? reject(result.error) : resolve(result.value as T)));
  });
}

type Harness = { adapter: ExpoSQLiteAdapter; db: FakeSqlite };

async function openAdapter(options: Parameters<typeof createFakeSqlite>[0] = {}): Promise<Harness> {
  const db = createFakeSqlite(options);
  sqLite.openDatabaseAsync.mockResolvedValueOnce(db);

  const adapter = new ExpoSQLiteAdapter({
    schema,
    dbName: 'damz.db',
    cipherKey: TEST_DB_KEY,
  });
  await adapter.open();

  return { adapter, db };
}

beforeEach(() => {
  // `resetAllMocks` (not `clearAllMocks`) so a `mockResolvedValueOnce` queued by
  // one test can never be consumed by the next.
  jest.resetAllMocks();
});

describe('TC-ADAPTER-01 — open()', () => {
  it('applies the key before touching the schema and never passes a `key` option', async () => {
    const { db } = await openAdapter();

    expect(sqLite.openDatabaseAsync).toHaveBeenCalledWith('damz.db');

    const statements = db.execAsync.mock.calls.map(([sql]: [string]) => sql);
    expect(statements[0]).toBe(`PRAGMA key = "x'${TEST_DB_KEY}'"`);
    expect(statements.some((sql) => sql.includes('create table "catalog_items"'))).toBe(true);
    expect(statements.indexOf(`PRAGMA key = "x'${TEST_DB_KEY}'"`)).toBeLessThan(
      statements.findIndex((sql) => sql.includes('create table')),
    );
  });

  it('fails loud when SQLCipher is not compiled into expo-sqlite', async () => {
    const db = createFakeSqlite({ sqlcipher: false });
    sqLite.openDatabaseAsync.mockResolvedValueOnce(db);
    const adapter = new ExpoSQLiteAdapter({ schema, dbName: 'damz.db', cipherKey: TEST_DB_KEY });

    await expect(adapter.open()).rejects.toThrow(/SQLCipher is not available/);
  });

  it('rejects a malformed key instead of opening a plaintext database', async () => {
    const adapter = new ExpoSQLiteAdapter({ schema, dbName: 'damz.db', cipherKey: 'nope' });

    await expect(adapter.open()).rejects.toThrow(/64-character hex/);
  });

  it('fails loud when the recorded migrations do not cover the database version', async () => {
    // A v1 database, but the only recorded migration targets v3, so
    // `stepsForMigration` finds no path (minVersion is 3 - 1 = 2).
    // WatermelonDB's own adapter responds by wiping and recreating the database;
    // for an encrypted local store that holds user data, refusing is the only
    // safe answer. The old implementation bumped `user_version` anyway, leaving
    // the schema silently older than the app believed it to be.
    const db = createFakeSqlite({ userVersion: 1 });
    sqLite.openDatabaseAsync.mockResolvedValueOnce(db);

    const adapter = new ExpoSQLiteAdapter({
      schema: watermelondb.appSchema({
        version: 3,
        tables: [
          watermelondb.tableSchema({
            name: 'catalog_items',
            columns: [{ name: 'display_name', type: 'string' }],
          }),
        ],
      }),
      dbName: 'damz.db',
      cipherKey: TEST_DB_KEY,
      migrations: schemaMigrations({
        migrations: [{ toVersion: 3, steps: [unsafeExecuteSql('select 1;')] }],
      }),
    });

    await expect(adapter.open()).rejects.toThrow(
      /No migration path from database schema version 1 to 3/,
    );
    // The version must not have been advanced.
    const statements = db.execAsync.mock.calls.map(([sql]: [string]) => sql);
    expect(statements.some((sql) => sql.startsWith('PRAGMA user_version ='))).toBe(false);
  });

  it('never lets the key reach an error message', async () => {
    const db = createFakeSqlite();
    // A failing statement is often echoed back verbatim by SQLite bindings.
    db.execAsync.mockImplementation(async (sql: string) => {
      if (/pragma key/i.test(sql)) throw new Error(`near "${sql}": syntax error`);
    });
    sqLite.openDatabaseAsync.mockResolvedValueOnce(db);

    const adapter = new ExpoSQLiteAdapter({ schema, dbName: 'damz.db', cipherKey: TEST_DB_KEY });
    const error = await adapter.open().then(
      () => null,
      (thrown: Error) => thrown,
    );

    expect(error).not.toBeNull();
    expect(error?.message).toContain('Failed to apply the SQLCipher key');
    expect(error?.message).not.toContain(TEST_DB_KEY);
    expect(error?.message).toContain('<redacted>');
  });
});

describe('TC-ADAPTER-01 — batch() writes through the real encoder', () => {
  it('inserts `id`, `_status` and `_changed` together with the columns', async () => {
    const { adapter, db } = await openAdapter();

    await call<void>((callback) =>
      adapter.batch(
        [
          [
            'create',
            'catalog_items',
            {
              id: 'cabbage',
              _status: 'created',
              _changed: '',
              display_name: 'Cabbage',
              sort_order: 1,
            } as any,
          ],
        ] as any,
        callback,
      ),
    );

    const insert = db.runAsync.mock.calls.find(([sql]: [string]) => /insert into/i.test(sql));
    expect(insert).toBeDefined();
    expect(insert[0]).toBe(
      'insert into "catalog_items" ("id", "_status", "_changed", "display_name", "sort_order") values (?, ?, ?, ?, ?)',
    );
    expect(insert[1]).toEqual(['cabbage', 'created', '', 'Cabbage', 1]);
    // The whole batch is one transaction.
    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it('updates by id without writing the id column', async () => {
    const { adapter, db } = await openAdapter();

    await call<void>((callback) =>
      adapter.batch(
        [
          [
            'update',
            'catalog_items',
            {
              id: 'cabbage',
              _status: 'updated',
              _changed: 'display_name',
              display_name: 'Green Cabbage',
              sort_order: 1,
            } as any,
          ],
        ] as any,
        callback,
      ),
    );

    const update = db.runAsync.mock.calls.find(([sql]: [string]) => /update/i.test(sql));
    expect(update[0]).toBe(
      'update "catalog_items" set "_status" = ?, "_changed" = ?, "display_name" = ?, "sort_order" = ? where "id" is ?',
    );
    expect(update[1]).toEqual(['updated', 'display_name', 'Green Cabbage', 1, 'cabbage']);
  });

  it('soft-deletes and hard-deletes by id', async () => {
    const { adapter, db } = await openAdapter();

    await call<void>((callback) =>
      adapter.batch([['markAsDeleted', 'catalog_items', 'cabbage']] as any, callback),
    );
    await call<void>((callback) =>
      adapter.batch([['destroyPermanently', 'catalog_items', 'spinach']] as any, callback),
    );

    expect(db.runAsync).toHaveBeenCalledWith(
      `update "catalog_items" set "_status" = 'deleted' where "id" == ?`,
      ['cabbage'],
    );
    expect(db.runAsync).toHaveBeenCalledWith(`delete from "catalog_items" where "id" == ?`, [
      'spinach',
    ]);
  });

  it('maps booleans to integers before binding', async () => {
    const { adapter, db } = await openAdapter();

    await call<void>((callback) =>
      adapter.batch(
        [
          [
            'create',
            'catalog_items',
            {
              id: 'x',
              _status: 'created',
              _changed: '',
              display_name: 'X',
              sort_order: true as any,
            } as any,
          ],
        ] as any,
        callback,
      ),
    );

    const insert = db.runAsync.mock.calls.find(([sql]: [string]) => /insert into/i.test(sql));
    expect(insert[1]).toContain(1);
    expect(insert[1]).not.toContain(true);
  });
});

describe('TC-ADAPTER-01 — query compilation', () => {
  it('compiles a plain query to real SQL instead of an empty string', async () => {
    const { adapter, db } = await openAdapter();
    db.getAllAsync.mockResolvedValueOnce([
      {
        id: 'cabbage',
        _status: 'synced',
        _changed: '',
        display_name: 'Cabbage',
        sort_order: 1,
      },
    ]);

    const rows = await call<any[]>((callback) => adapter.query(makeQuery(), callback));

    expect(db.getAllAsync).toHaveBeenCalledWith(
      'select "catalog_items".* from "catalog_items"',
      [],
    );
    // `sanitizeQueryResult` fills in the schema defaults WatermelonDB expects.
    expect(rows[0]).toMatchObject({ id: 'cabbage', display_name: 'Cabbage', sort_order: 1 });
  });

  it('compiles where clauses through encodeQuery', async () => {
    const { adapter, db } = await openAdapter();

    await call<any[]>((callback) =>
      adapter.query(
        makeQuery({
          where: [
            {
              type: 'where',
              left: 'sort_order',
              comparison: { operator: 'eq', right: { value: 2 } },
            },
          ],
        }),
        callback,
      ),
    );

    expect(db.getAllAsync).toHaveBeenCalledWith(
      'select "catalog_items".* from "catalog_items" where "catalog_items"."sort_order" is 2',
      [],
    );
  });

  it('honours a raw unsafeSqlQuery verbatim', async () => {
    const { adapter, db } = await openAdapter();

    await call<any[]>((callback) =>
      adapter.query(makeQuery({ sql: { sql: 'select id from catalog_items', values: [] } }), callback),
    );

    expect(db.getAllAsync).toHaveBeenCalledWith('select id from catalog_items', []);
  });

  it('returns ids from queryIds', async () => {
    const { adapter, db } = await openAdapter();
    db.getAllAsync.mockResolvedValueOnce([{ id: 'cabbage' }, { id: 'spinach' }]);

    const ids = await call<string[]>((callback) => adapter.queryIds(makeQuery(), callback));

    expect(ids).toEqual(['cabbage', 'spinach']);
  });

  it('finds a row and sanitizes it, quoting the table name', async () => {
    const { adapter, db } = await openAdapter();
    db.getFirstAsync.mockResolvedValueOnce({
      id: 'cabbage',
      _status: 'synced',
      _changed: '',
      display_name: 'Cabbage',
      sort_order: 1,
    });

    const row = await call<any>((callback) => adapter.find('catalog_items', 'cabbage', callback));

    expect(db.getFirstAsync).toHaveBeenCalledWith(
      'SELECT * FROM "catalog_items" WHERE id == ? LIMIT 1',
      ['cabbage'],
    );
    expect(row).toMatchObject({ id: 'cabbage', display_name: 'Cabbage' });
  });

  it('returns null from find for a missing row', async () => {
    const { adapter, db } = await openAdapter();
    db.getFirstAsync.mockResolvedValueOnce(null);

    await expect(call((callback) => adapter.find('catalog_items', 'nope', callback))).resolves.toBeNull();
  });
});

describe('TC-ADAPTER-01 — count()', () => {
  it('runs a count query and reads the `count` column', async () => {
    const { adapter, db } = await openAdapter();
    db.getAllAsync.mockResolvedValueOnce([{ count: 8 }]);

    const total = await call<number>((callback) => adapter.count(makeQuery(), callback));

    expect(db.getAllAsync).toHaveBeenCalledWith(
      'select count(*) as "count" from "catalog_items"',
      [],
    );
    expect(total).toBe(8);
  });

  it('fails loud when the result has no `count` column', async () => {
    const { adapter, db } = await openAdapter();
    db.getAllAsync.mockResolvedValueOnce([{ id: 'cabbage' }]);

    await expect(
      call((callback) => adapter.count(makeQuery({ sql: { sql: 'select * from catalog_items', values: [] } }), callback)),
    ).rejects.toThrow(/count/);
  });
});

describe('TC-ADAPTER-01 — deleted records', () => {
  it('selects soft-deleted ids', async () => {
    const { adapter, db } = await openAdapter();
    db.getAllAsync.mockResolvedValueOnce([{ id: 'cabbage' }]);

    const ids = await call<string[]>((callback) =>
      adapter.getDeletedRecords('catalog_items', callback),
    );

    expect(db.getAllAsync).toHaveBeenCalledWith(
      `SELECT id FROM "catalog_items" WHERE _status = 'deleted'`,
    );
    expect(ids).toEqual(['cabbage']);
  });

  it('destroys the given ids in one statement', async () => {
    const { adapter, db } = await openAdapter();

    await call<void>((callback) =>
      adapter.destroyDeletedRecords('catalog_items', ['a', 'b'], callback),
    );

    expect(db.runAsync).toHaveBeenCalledWith(
      `DELETE FROM "catalog_items" WHERE id IN (?, ?)`,
      ['a', 'b'],
    );
  });

  it('does not touch the database when there is nothing to destroy', async () => {
    const { adapter, db } = await openAdapter();

    await call<void>((callback) => adapter.destroyDeletedRecords('catalog_items', [], callback));

    expect(db.runAsync).not.toHaveBeenCalled();
  });
});

describe('TC-ADAPTER-01 — local storage, vacuum and reset', () => {
  it('round-trips local storage with quoted identifiers', async () => {
    const { adapter, db } = await openAdapter();
    db.getFirstAsync.mockResolvedValueOnce({ value: 'on' });

    await call<void>((callback) => adapter.setLocal('tor_enabled', 'on', callback));
    expect(db.runAsync).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO "local_storage" ("key", "value") VALUES (?, ?)',
      ['tor_enabled', 'on'],
    );

    const value = await call<string | undefined>((callback) => adapter.getLocal('tor_enabled', callback));
    expect(value).toBe('on');

    await call<void>((callback) => adapter.removeLocal('tor_enabled', callback));
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM "local_storage" WHERE "key" = ?', [
      'tor_enabled',
    ]);
  });

  it('runs VACUUM outside any transaction', async () => {
    const { adapter, db } = await openAdapter();

    await adapter.vacuum();

    expect(db.execAsync).toHaveBeenCalledWith('VACUUM');
    expect(db.withTransactionAsync).not.toHaveBeenCalled();
  });

  it('runs unsafeExecute statements inside one transaction', async () => {
    const { adapter, db } = await openAdapter();

    await call<void>((callback) =>
      adapter.unsafeExecute({ sqls: [['delete from "orders" where id = ?', ['o1']]] }, callback),
    );

    expect(db.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(db.runAsync).toHaveBeenCalledWith('delete from "orders" where id = ?', ['o1']);
  });

  it('resets the database by dropping everything and rebuilding the schema', async () => {
    const { adapter, db } = await openAdapter();
    db.getAllAsync.mockResolvedValueOnce([{ name: 'orders' }, { name: 'catalog_items' }]);
    db.execAsync.mockClear();

    await call<void>((callback) => adapter.unsafeResetDatabase(callback));

    const statements = db.execAsync.mock.calls.map(([sql]: [string]) => sql);
    expect(statements).toContain('DROP TABLE IF EXISTS "orders"');
    expect(statements).toContain('DROP TABLE IF EXISTS "catalog_items"');
    expect(statements).toContain('PRAGMA user_version = 0');
    // The schema is rebuilt and re-versioned — the old implementation dropped
    // the tables and left the database unusable.
    expect(statements.some((sql) => sql.includes('create table "catalog_items"'))).toBe(true);
    expect(statements).toContain('PRAGMA user_version = 1');
    expect(statements).toContain('VACUUM');
  });
});
