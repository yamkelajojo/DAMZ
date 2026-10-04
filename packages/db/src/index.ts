/**
 * @damz/db — WatermelonDB + SQLCipher Database
 *
 * Provides database instance for Customer and Runner apps.
 * Each app gets its own encrypted database file.
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { migrations } from './migrations';
import { schema } from './schemas/schema';
import { CUSTOMER_MODELS, RUNNER_MODELS, MODELS, TABLES } from './models';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

export type Persona = 'customer' | 'runner';

const DB_NAME = 'damz.db';
const DB_KEY_KEY = 'damz_db_key';

let customerDatabase: Database | null = null;
let runnerDatabase: Database | null = null;

/**
 * Get or generate the SQLCipher database key from secure storage
 */
export async function getDatabaseKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(DB_KEY_KEY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to unlock DAMZ database',
  });

  if (!key) {
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    key = Buffer.from(randomBytes).toString('hex');
    await SecureStore.setItemAsync(DB_KEY_KEY, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: true,
      authenticationPrompt: 'Authenticate to save DAMZ database key',
    });
  }

  return key;
}

/**
 * Create database adapter with SQLCipher
 */
function createAdapter(key: string): SQLiteAdapter {
  return new SQLiteAdapter({
    schema,
    migrations,
    dbName: DB_NAME,
    cipherKey: key,
    jsi: true, // Use JSI for better performance
    onSetUpError: (error) => {
      console.error('Database setup error:', error);
    },
  });
}

/**
 * Get or create Customer app database
 */
export async function getCustomerDatabase(): Promise<Database> {
  if (customerDatabase) return customerDatabase;

  const key = await getDatabaseKey();
  const adapter = createAdapter(key);

  customerDatabase = new Database({
    adapter,
    modelClasses: CUSTOMER_MODELS,
    actionsEnabled: true,
  });

  return customerDatabase;
}

/**
 * Get or create Runner app database
 */
export async function getRunnerDatabase(): Promise<Database> {
  if (runnerDatabase) return runnerDatabase;

  const key = await getDatabaseKey();
  const adapter = createAdapter(key);

  runnerDatabase = new Database({
    adapter,
    modelClasses: RUNNER_MODELS,
    actionsEnabled: true,
  });

  return runnerDatabase;
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
 */
export async function purgeExpiredData(persona: Persona): Promise<void> {
  const db = await getDatabase(persona);
  const now = Date.now();

  await db.write(async () => {
    const ordersCol = db.get(TABLES.ORDERS);
    const expired = await ordersCol
      .query(
        (q) => q.where('purge_after', q.lte(now)).where('dispute_state', q.notEq('open'))
      )
      .fetch();

    for (const order of expired) {
      await order.destroyPermanently();
    }

    // VACUUM to reclaim space
    await db.adapter.unsafeSqlQuery('VACUUM;');
  });
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
  const existingIds = new Set(existing.map((record) => record.id));
  const missingItems = items.filter((item) => !existingIds.has(item.id));
  if (missingItems.length === 0) return;

  await db.write(async () => {
    for (const item of missingItems) {
      await catalogCol.create((record) => {
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
  if (customerDatabase) {
    customerDatabase.adapter.close();
    customerDatabase = null;
  }
  if (runnerDatabase) {
    runnerDatabase.adapter.close();
    runnerDatabase = null;
  }
}

/**
 * Reset database (for testing or user-initiated wipe)
 */
export async function resetDatabase(persona: Persona): Promise<void> {
  const db = await getDatabase(persona);
  await db.write(async () => {
    for (const table of Object.values(TABLES)) {
      const col = db.get(table);
      const all = await col.query().fetch();
      for (const record of all) {
        await record.destroyPermanently();
      }
    }
  });
  await db.adapter.unsafeSqlQuery('VACUUM;');
}

// Re-export for convenience
export { TABLES, MODELS, CUSTOMER_MODELS, RUNNER_MODELS } from './models';
export { schema } from './schemas/schema';