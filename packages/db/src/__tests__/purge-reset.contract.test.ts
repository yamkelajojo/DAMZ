/**
 * TC-DB-RETENTION-01 — purge and wipe must delete exactly what the retention
 * rules say, and nothing else.
 *
 * The document of record is `DB_LAYOUT_AND_ARCH.md` §6: messages purge 30 days
 * after completion, orders (with everything hanging off them) after 90, and an
 * open dispute freezes both. This suite pins down two gaps it found:
 *
 *  - `purgeExpiredData` deleted only the `orders` row. Order items, messages,
 *    payment events, the proof-bundle row and the dispute stayed on disk
 *    forever, so the 30-day message window never took effect at all.
 *  - `resetDatabase` walked every table in the schema, but the Runner database
 *    deliberately has no `strikes` model (ADR-0005) and `Database.get()` returns
 *    `null` for a table with no registered model — so the Runner wipe threw a
 *    `TypeError` part-way through.
 */

jest.mock(
  '@nozbe/watermelondb',
  () => ({
    // Real `Q`, real `Model`/decorators (so `../models` loads for real); only
    // the `Database` constructor is replaced with the fake below.
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

jest.mock(
  'expo-sqlite',
  () => ({
    __esModule: true,
    openDatabaseAsync: jest.fn(async () => createFakeSqliteDatabase()),
  }),
  { virtual: true },
);

function createFakeSqliteDatabase() {
  return {
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => undefined),
    getFirstAsync: jest.fn(async (sql: string) => {
      if (/cipher_version/i.test(sql)) return { cipher_version: '4.7.0 community' };
      if (/user_version/i.test(sql)) return { user_version: 3 };
      if (/sqlite_master/i.test(sql)) return { n: 1 };
      return null;
    }),
    closeAsync: jest.fn(async () => undefined),
  };
}

import { closeDatabases, purgeExpiredData, resetDatabase } from '../index';
import { CUSTOMER_MODELS, RUNNER_MODELS } from '../models';

const watermelondb = require('@nozbe/watermelondb') as { Database: jest.Mock };
const secureStore = require('expo-secure-store') as { getItemAsync: jest.Mock };

/** 32 random bytes, hex-encoded — the shape `getDatabaseKey()` produces. */
const TEST_DB_KEY = 'a'.repeat(64);

const DAY_MS = 24 * 60 * 60 * 1000;

/** The five schema tables carrying `order_id`, which must cascade with an order. */
const ORDER_CHILD_TABLES = [
  'disputes',
  'messages',
  'order_items',
  'payment_events',
  'proof_bundles',
];

/** The schema table carrying `swap_id`, which must cascade with a swap. */
const SWAP_CHILD_TABLES = ['swap_events'];

type FakeRow = { id: string } & Record<string, unknown>;

/**
 * The real shape produced by `Q.where(...)`:
 * `{ type: 'where', left: 'column', comparison: { operator, right: { value } } }`
 * (`oneOf` carries `right.values` instead).
 */
type QueryClause = {
  type: string;
  left: string;
  comparison: { operator: string; right: { value?: unknown; values?: unknown[] } };
};

function clauseMatches(clause: QueryClause, row: FakeRow): boolean {
  const { operator, right } = clause.comparison;
  const value = row[clause.left];

  switch (operator) {
    case 'lte':
      // A NULL deadline never compares true, so the row is retained.
      return typeof value === 'number' && value <= (right.value as number);
    case 'notEq':
      return value !== right.value;
    case 'oneOf':
      return (right.values ?? []).includes(value);
    default:
      throw new Error(`Test fake does not implement the '${operator}' operator`);
  }
}

function createFakeDatabase(persona: 'customer' | 'runner', seed: Record<string, FakeRow[]> = {}) {
  const registered = (persona === 'customer' ? CUSTOMER_MODELS : RUNNER_MODELS).map(
    (model) => model.table,
  );

  const tables: Record<string, FakeRow[]> = {};
  for (const table of registered) {
    tables[table] = [...(seed[table] ?? [])];
  }

  const deletions: { table: string; id: string }[] = [];
  const events: string[] = [];

  const get = jest.fn((table: string) => {
    // Mirrors `CollectionMap.get`, which returns `null` for a table with no
    // registered model class.
    if (!registered.includes(table)) return null;

    return {
      query: jest.fn((...clauses: QueryClause[]) => ({
        fetch: jest.fn(async () =>
          tables[table]
            .filter((row) => clauses.every((clause) => clauseMatches(clause, row)))
            .map((row) => ({
              id: row.id,
              destroyPermanently: jest.fn(async () => {
                tables[table] = tables[table].filter((candidate) => candidate.id !== row.id);
                deletions.push({ table, id: row.id });
              }),
            })),
        ),
      })),
    };
  });

  const write = jest.fn(async (block: () => Promise<void>) => {
    await block();
    events.push('write');
  });

  const vacuum = jest.fn(async () => {
    events.push('vacuum');
  });

  const db = {
    get,
    write,
    adapter: { underlyingAdapter: { close: jest.fn(async () => undefined), vacuum } },
  };

  return { db, tables, deletions, events, get, write, vacuum };
}

let context: ReturnType<typeof createFakeDatabase>;

function useDatabase(persona: 'customer' | 'runner', seed?: Record<string, FakeRow[]>): void {
  context = createFakeDatabase(persona, seed);
  watermelondb.Database.mockImplementation(() => context.db);
}

beforeEach(async () => {
  await closeDatabases();
  jest.clearAllMocks();
  secureStore.getItemAsync.mockResolvedValue(TEST_DB_KEY);
});

afterEach(async () => {
  await closeDatabases();
});

describe('TC-DB-RETENTION-01 — purgeExpiredData', () => {
  it('deletes messages on their own 30-day deadline even while their order is retained', async () => {
    const now = Date.now();
    useDatabase('customer', {
      orders: [{ id: 'recent', purge_after: now + DAY_MS, dispute_state: 'none' }],
      messages: [
        { id: 'old-message', order_id: 'recent', purge_after: now - DAY_MS },
        { id: 'new-message', order_id: 'recent', purge_after: now + DAY_MS },
      ],
    });

    await purgeExpiredData('customer');

    expect(context.tables.messages.map((row) => row.id)).toEqual(['new-message']);
    expect(context.tables.orders.map((row) => row.id)).toEqual(['recent']);
  });

  it('keeps rows that have no purge deadline', async () => {
    useDatabase('customer', {
      messages: [
        { id: 'no-deadline', order_id: 'order-1' },
        { id: 'null-deadline', order_id: 'order-1', purge_after: null },
      ],
    });

    await purgeExpiredData('customer');

    expect(context.tables.messages.map((row) => row.id).sort()).toEqual([
      'no-deadline',
      'null-deadline',
    ]);
  });

  it('cascades an expired order to every table that references it', async () => {
    const now = Date.now();
    useDatabase('customer', {
      orders: [{ id: 'expired', purge_after: now - DAY_MS, dispute_state: 'none' }],
      order_items: [{ id: 'item-1', order_id: 'expired' }],
      // Deliberately *not* due on its own: it must still go with the order.
      messages: [{ id: 'message-1', order_id: 'expired', purge_after: now + DAY_MS }],
      payment_events: [{ id: 'payment-1', order_id: 'expired' }],
      proof_bundles: [{ id: 'bundle-1', order_id: 'expired' }],
      disputes: [{ id: 'dispute-1', order_id: 'expired' }],
    });

    await purgeExpiredData('customer');

    for (const table of ['orders', ...ORDER_CHILD_TABLES]) {
      expect(context.tables[table]).toEqual([]);
    }

    // A new order-scoped table must be added to ORDER_CHILD_TABLES deliberately.
    expect([...new Set(context.deletions.map(({ table }) => table))].sort()).toEqual(
      ['orders', ...ORDER_CHILD_TABLES].sort(),
    );
  });

  it('leaves an orphan-free database untouched when nothing has expired', async () => {
    const now = Date.now();
    useDatabase('customer', {
      orders: [{ id: 'order-1', purge_after: now + DAY_MS, dispute_state: 'none' }],
      order_items: [{ id: 'item-1', order_id: 'order-1' }],
      messages: [{ id: 'message-1', order_id: 'order-1', purge_after: now + DAY_MS }],
    });

    await purgeExpiredData('customer');

    expect(context.deletions).toEqual([]);
  });

  it('freezes an order with an open dispute, and its children with it', async () => {
    const now = Date.now();
    useDatabase('customer', {
      orders: [{ id: 'disputed', purge_after: now - DAY_MS, dispute_state: 'open' }],
      order_items: [{ id: 'item-1', order_id: 'disputed' }],
      messages: [{ id: 'message-1', order_id: 'disputed', purge_after: now + DAY_MS }],
    });

    await purgeExpiredData('customer');

    expect(context.tables.orders.map((row) => row.id)).toEqual(['disputed']);
    expect(context.tables.order_items.map((row) => row.id)).toEqual(['item-1']);
    expect(context.tables.messages.map((row) => row.id)).toEqual(['message-1']);
  });

  it('vacuums only after the write transaction has finished', async () => {
    useDatabase('customer', {});

    await purgeExpiredData('customer');

    // SQLite rejects `VACUUM` inside a transaction, so ordering is the contract.
    expect(context.events).toEqual(['write', 'vacuum']);
  });

  it('never touches a table the persona has no model for', async () => {
    const now = Date.now();
    useDatabase('runner', {
      orders: [{ id: 'expired', purge_after: now - DAY_MS, dispute_state: 'none' }],
    });

    await purgeExpiredData('runner');

    expect(context.get.mock.calls.map((call) => call[0])).not.toContain('strikes');
  });

  it('purges a terminal swap past its 90-day deadline, with its events', async () => {
    const now = Date.now();
    useDatabase('customer', {
      swaps: [{ id: 'swap-1', status: 'completed', purge_after: now - DAY_MS }],
      swap_events: [{ id: 'event-1', swap_id: 'swap-1' }],
    });

    await purgeExpiredData('customer');

    expect(context.tables.swaps).toEqual([]);
    expect(context.tables.swap_events).toEqual([]);
    expect([...new Set(context.deletions.map(({ table }) => table))].sort()).toEqual(
      ['swaps', ...SWAP_CHILD_TABLES].sort(),
    );
  });

  it('never purges an in-flight swap, even if a deadline were set on it', async () => {
    const now = Date.now();
    useDatabase('customer', {
      // Funds are in transit — deleting this row would lose the record of them.
      swaps: [{ id: 'swap-1', status: 'executing', purge_after: now - DAY_MS }],
      swap_events: [{ id: 'event-1', swap_id: 'swap-1' }],
    });

    await purgeExpiredData('customer');

    expect(context.tables.swaps.map((row) => row.id)).toEqual(['swap-1']);
    expect(context.tables.swap_events.map((row) => row.id)).toEqual(['event-1']);
    expect(context.deletions).toEqual([]);
  });

  it('keeps swaps that have no deadline yet', async () => {
    useDatabase('customer', {
      swaps: [
        { id: 'no-deadline', status: 'completed' },
        { id: 'null-deadline', status: 'refunded', purge_after: null },
      ],
    });

    await purgeExpiredData('customer');

    expect(context.tables.swaps.map((row) => row.id).sort()).toEqual([
      'no-deadline',
      'null-deadline',
    ]);
  });
});

describe('TC-DB-RETENTION-01 — resetDatabase', () => {
  it('empties every table the customer app registers', async () => {
    useDatabase('customer');
    const registered = Object.keys(context.tables);
    for (const table of registered) {
      context.tables[table].push({ id: `${table}-1` });
    }

    await resetDatabase('customer');

    for (const table of registered) {
      expect(context.tables[table]).toEqual([]);
    }
    expect(registered).toContain('strikes');
  });

  it('wipes the runner database without reaching for the unregistered strikes table', async () => {
    useDatabase('runner');
    const registered = Object.keys(context.tables);
    for (const table of registered) {
      context.tables[table].push({ id: `${table}-1` });
    }

    await expect(resetDatabase('runner')).resolves.toBeUndefined();

    for (const table of registered) {
      expect(context.tables[table]).toEqual([]);
    }

    const visited = context.get.mock.calls.map((call) => call[0]);
    expect(visited).not.toContain('strikes');
    expect([...visited].sort()).toEqual(
      RUNNER_MODELS.map((model) => model.table).sort(),
    );
    expect(RUNNER_MODELS.map((model) => model.table)).not.toContain('strikes');
  });

  it('vacuums only after the write transaction has finished', async () => {
    useDatabase('customer');

    await resetDatabase('customer');

    expect(context.events).toEqual(['write', 'vacuum']);
  });
});
