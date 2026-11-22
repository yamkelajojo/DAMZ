/**
 * @damz/db — WatermelonDB + SQLCipher Database
 *
 * Provides database instance for Customer and Runner apps.
 * Each app gets its own encrypted database file.
 * Uses custom ExpoSQLiteAdapter for SQLCipher encryption via expo-sqlite@57+.
 */

import { Database, Q } from '@nozbe/watermelondb';
import { migrations } from './migrations';
import { schema, TABLE_SCHEMA_SPECS } from './schemas/schema';
import { CUSTOMER_MODELS, RUNNER_MODELS, TABLES } from './models';
import { ExpoSQLiteAdapter } from './adapters/ExpoSQLiteAdapter';
import * as SecureStore from 'expo-secure-store';
export { PaymentNotificationReplayStore } from './payment-notification-replay';
export type { GatewayPaymentNotificationRecord } from './payment-notification-replay';

export type Persona = 'customer' | 'runner';

const DB_NAME = 'damz.db';
const DB_KEY_KEY = 'damz_db_key';

let customerDatabase: Database | null = null;
let runnerDatabase: Database | null = null;

// In-flight open operations. Caching the *promise* (not just the result) is
// what makes concurrent first-launch calls safe — see `getDatabaseKey` and
// `openDatabase`.
let databaseKeyPromise: Promise<string> | null = null;
let customerDatabasePromise: Promise<Database> | null = null;
let runnerDatabasePromise: Promise<Database> | null = null;

/**
 * Get or generate the SQLCipher database key from secure storage.
 *
 * The in-flight promise is memoised. Without that, two concurrent callers on
 * first launch would each read `null` and generate a *different* key; one key
 * wins in secure storage and the other's database file becomes unopenable. A
 * rejected attempt is not cached so a later call can retry.
 */
export function getDatabaseKey(): Promise<string> {
  if (!databaseKeyPromise) {
    databaseKeyPromise = loadOrCreateDatabaseKey().catch((error) => {
      databaseKeyPromise = null;
      throw error;
    });
  }
  return databaseKeyPromise;
}

async function loadOrCreateDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DB_KEY_KEY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to unlock DAMZ database',
  });

  if (existing) return existing;

  // `crypto.getRandomValues` returns the same typed array synchronously; it is
  // not a promise. It is provided by Expo's WinterCG runtime.
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  await SecureStore.setItemAsync(DB_KEY_KEY, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to save DAMZ database key',
  });

  return key;
}

/**
 * Create database adapter with SQLCipher using expo-sqlite
 */
function createAdapter(key: string): ExpoSQLiteAdapter {
  return new ExpoSQLiteAdapter({
    schema,
    migrations,
    dbName: DB_NAME,
    cipherKey: key,
    jsi: true,
    onSetUpError: (error: Error) => {
      console.error('Database setup error:', error);
    },
  });
}

/** WatermelonDB wraps the adapter; the raw adapter exposes `close`/`vacuum`. */
function getUnderlyingAdapter(db: Database): ExpoSQLiteAdapter {
  return (db.adapter as unknown as { underlyingAdapter: ExpoSQLiteAdapter }).underlyingAdapter;
}

/**
 * Tables registered for a persona.
 *
 * `Database.get()` returns `null` for a table with no registered model class
 * (`CollectionMap.get`), so callers must never walk the whole schema: the Runner
 * database deliberately has no `strikes` model (ADR-0005).
 */
function modelTablesFor(persona: Persona): Set<string> {
  const modelClasses = persona === 'customer' ? CUSTOMER_MODELS : RUNNER_MODELS;
  return new Set(modelClasses.map((model) => model.table));
}

/**
 * Tables that hold a row's children through a foreign-key column.
 *
 * Derived from the schema rather than hard-coded, so a child table added later is
 * cascaded automatically. Before this, purging an order deleted only the order:
 * its items, messages, payment events, proof-bundle row and dispute stayed on
 * disk forever, which is exactly what the retention rules exist to prevent
 * (`DB_LAYOUT_AND_ARCH.md` §6).
 */
function childTablesFor(foreignKeyColumn: string, allowed: Set<string>): string[] {
  return TABLE_SCHEMA_SPECS.filter((table) => allowed.has(table.name))
    .filter((table) => table.columns.some((column) => column.name === foreignKeyColumn))
    .map((table) => table.name);
}

/**
 * Swap statuses that mean the swap is finished and may be purged.
 *
 * Listed explicitly and matched with `Q.oneOf` so a status added later is
 * *excluded* until someone decides otherwise — an in-flight swap must never be
 * deleted mid-execution.
 */
const TERMINAL_SWAP_STATUSES = ['completed', 'refunded', 'failed', 'expired'];

async function openDatabase(
  modelClasses: (typeof CUSTOMER_MODELS),
): Promise<Database> {
  const key = await getDatabaseKey();
  const adapter = createAdapter(key);
  await adapter.open();
  return new Database({ adapter, modelClasses });
}

/**
 * Get or create Customer app database
 */
export function getCustomerDatabase(): Promise<Database> {
  if (!customerDatabasePromise) {
    customerDatabasePromise = openDatabase(CUSTOMER_MODELS)
      .then((db) => {
        customerDatabase = db;
        return db;
      })
      .catch((error) => {
        customerDatabasePromise = null;
        throw error;
      });
  }
  return customerDatabasePromise;
}

/**
 * Get or create Runner app database
 */
export function getRunnerDatabase(): Promise<Database> {
  if (!runnerDatabasePromise) {
    runnerDatabasePromise = openDatabase(RUNNER_MODELS)
      .then((db) => {
        runnerDatabase = db;
        return db;
      })
      .catch((error) => {
        runnerDatabasePromise = null;
        throw error;
      });
  }
  return runnerDatabasePromise;
}

/** Get the encrypted Runner DB's durable event-ID replay store. */
export async function getRunnerPaymentNotificationReplayStore() {
  const database = await getRunnerDatabase();
  const { PaymentNotificationReplayStore } = await import('./payment-notification-replay');
  return new PaymentNotificationReplayStore(database);
}

/**
 * Get database for the current persona
 */
export async function getDatabase(persona: Persona): Promise<Database> {
  if (persona === 'customer') return getCustomerDatabase();
  return getRunnerDatabase();
}

/**
 * Purge expired data (run on app launch + daily)
 * From DB_LAYOUT_AND_ARCH.md §6
 *
 * Retention: messages 30 days after completion; orders and swaps (with
 * everything hanging off them) 90 days — orders permanently frozen while
 * `dispute_state = 'open'`, swaps only once terminal.
 */
export async function purgeExpiredData(persona: Persona): Promise<void> {
  const db = await getDatabase(persona);
  const now = Date.now();
  const allowedTables = modelTablesFor(persona);
  const orderChildTables = childTablesFor('order_id', allowedTables);
  const swapChildTables = childTablesFor('swap_id', allowedTables);

  await db.write(async () => {
    // Messages carry their own, shorter deadline and must go even while their
    // order is still inside the 90-day window. `purge_after` is nullable: a NULL
    // deadline never compares true, so those rows are kept.
    const expiredMessages = await db
      .get(TABLES.MESSAGES)
      .query(Q.where('purge_after', Q.lte(now)))
      .fetch();
    for (const message of expiredMessages) {
      await message.destroyPermanently();
    }

    const expiredOrders = await db
      .get(TABLES.ORDERS)
      .query(
        Q.where('purge_after', Q.lte(now)),
        Q.where('dispute_state', Q.notEq('open')),
      )
      .fetch();
    const expiredOrderIds = expiredOrders.map((order) => order.id);

    if (expiredOrderIds.length > 0) {
      // Cascade before deleting the parent, in one query per child table.
      // (`Q.oneOf([])` is skipped deliberately: an empty `IN ()` list is not
      // valid SQL.)
      //
      // Note `proof_bundles` carries its own `purge_after`, which is *not* used
      // here: `DB_LAYOUT_AND_ARCH.md` §6 retains a proof bundle "with the order",
      // and an open dispute keeps the order (and the key ADR-0003 stores on it).
      // Deleting the bundle on its own deadline would destroy the CID an open
      // dispute depends on while keeping the key that decrypts it.
      for (const childTable of orderChildTables) {
        const children = await db
          .get(childTable)
          .query(Q.where('order_id', Q.oneOf(expiredOrderIds)))
          .fetch();
        for (const child of children) {
          await child.destroyPermanently();
        }
      }

      for (const order of expiredOrders) {
        await order.destroyPermanently();
      }
    }

    // Swaps: 90 days, same as orders. The status guard is what keeps an
    // in-flight swap (funds in transit) out of the delete path even if a
    // deadline were somehow set on it.
    const expiredSwaps = await db
      .get(TABLES.SWAPS)
      .query(
        Q.where('purge_after', Q.lte(now)),
        Q.where('status', Q.oneOf(TERMINAL_SWAP_STATUSES)),
      )
      .fetch();

    if (expiredSwaps.length > 0) {
      const expiredSwapIds = expiredSwaps.map((swap) => swap.id);

      for (const childTable of swapChildTables) {
        const children = await db
          .get(childTable)
          .query(Q.where('swap_id', Q.oneOf(expiredSwapIds)))
          .fetch();
        for (const child of children) {
          await child.destroyPermanently();
        }
      }

      for (const swap of expiredSwaps) {
        await swap.destroyPermanently();
      }
    }
  });

  // VACUUM runs *after* the write transaction: SQLite rejects it inside one.
  await getUnderlyingAdapter(db).vacuum();
}

/**
 * Seed catalog items (run once on first launch)
 */
export async function seedCatalogItems(persona: Persona): Promise<void> {
  const db = await getDatabase(persona);
  const catalogCol = db.get(TABLES.CATALOG_ITEMS);

  const existing = await catalogCol.query().fetch();

  const items = [
    { id: 'cabbage', display_name: 'Cabbage', sort_order: 1 },
    { id: 'spinach', display_name: 'Spinach', sort_order: 2 },
    { id: 'cinnamon', display_name: 'Cinnamon', sort_order: 3 },
    { id: 'cauliflower', display_name: 'Cauliflower', sort_order: 4 },
    { id: 'rock_salt', display_name: 'Rock Salt', sort_order: 5 },
    { id: 'flour', display_name: 'Flour', sort_order: 6 },
    { id: 'bicarbonate_of_soda', display_name: 'Bicarbonate of Soda', sort_order: 7 },
    { id: 'grape_soda', display_name: 'Grape Soda (Small Bottle)', sort_order: 8 },
  ];
  const existingIds = new Set(existing.map((record: { id: string }) => record.id));
  const missingItems = items.filter((item) => !existingIds.has(item.id));
  if (missingItems.length === 0) return;

  await db.write(async () => {
    for (const item of missingItems) {
      await catalogCol.create((record: any) => {
        record._raw.id = item.id;
        record.displayName = item.display_name;
        record.sortOrder = item.sort_order;
      });
    }
  });
}

/**
 * Initialize database for persona (key, schema, seed)
 */
export async function initializeDatabase(persona: Persona): Promise<Database> {
  const db = await getDatabase(persona);
  await seedCatalogItems(persona);
  return db;
}

/**
 * Close databases (on app termination)
 */
export async function closeDatabases(): Promise<void> {
  const closing: Promise<void>[] = [];

  if (customerDatabase) {
    closing.push(getUnderlyingAdapter(customerDatabase).close());
  }
  if (runnerDatabase) {
    closing.push(getUnderlyingAdapter(runnerDatabase).close());
  }

  // Drop the memoised handles even if closing fails, so a later call reopens
  // from disk instead of handing back a closed database. The cached key goes
  // with them: it belongs to the database session, and re-reading it from
  // secure storage is what a fresh session does anyway.
  customerDatabase = null;
  runnerDatabase = null;
  customerDatabasePromise = null;
  runnerDatabasePromise = null;
  databaseKeyPromise = null;

  await Promise.all(closing);
}

/**
 * Reset database (for testing or user-initiated wipe)
 *
 * Walks the persona's registered models, not every table in the schema: the
 * Runner database has no `strikes` model, and `Database.get()` returns `null`
 * for those tables, so the previous `Object.values(TABLES)` loop threw a
 * `TypeError` part-way through the wipe.
 */
export async function resetDatabase(persona: Persona): Promise<void> {
  const db = await getDatabase(persona);

  await db.write(async () => {
    for (const table of modelTablesFor(persona)) {
      const records = await db.get(table).query().fetch();
      for (const record of records) {
        await record.destroyPermanently();
      }
    }
  });

  // Outside the write transaction — see `purgeExpiredData`.
  await getUnderlyingAdapter(db).vacuum();
}

// Re-export for convenience
export { TABLES, MODELS, CUSTOMER_MODELS, RUNNER_MODELS } from './models';
export { schema } from './schemas/schema';
