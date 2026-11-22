/**
 * ExpoSQLiteAdapter — WatermelonDB DatabaseAdapter using expo-sqlite (Expo SDK 57+)
 *
 * Provides SQLCipher encryption for expo-sqlite (enabled with the plugin option
 * `useSQLCipher: true`) by applying `PRAGMA key` on open. No bare workflow
 * required; works in the Expo managed workflow.
 *
 * SQL generation and result sanitation are delegated to WatermelonDB's own
 * modules (`encodeQuery`, `encodeBatch`, `sanitizeFindResult`, …) rather than
 * re-implemented here. That is what the library's `SQLiteAdapter` does: it
 * encodes a query in JavaScript and hands the resulting SQL to the native side.
 * Re-implementing it locally produced statements that did not match what
 * WatermelonDB expects (e.g. inserts without `id`) and silently returned empty
 * results for every non-raw query.
 */

import {
  DatabaseAdapter,
} from '@nozbe/watermelondb';
import type {
  AppSchema,
  SchemaMigrations,
  TableName,
  RecordId,
  RawRecord,
} from '@nozbe/watermelondb';
import type { SerializedQuery } from '@nozbe/watermelondb/Query';
import type { ResultCallback } from '@nozbe/watermelondb/utils/fp/Result';
import type { SQLiteArg, SQLiteQuery } from '@nozbe/watermelondb/adapters/sqlite/type';
import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import { encodeSchema, encodeMigrationSteps } from '@nozbe/watermelondb/adapters/sqlite/encodeSchema';
import encodeQuery from '@nozbe/watermelondb/adapters/sqlite/encodeQuery';
import encodeBatch from '@nozbe/watermelondb/adapters/sqlite/encodeBatch';
import { sanitizeFindResult, sanitizeQueryResult } from '@nozbe/watermelondb/adapters/common';
import { stepsForMigration } from '@nozbe/watermelondb/Schema/migrations/stepsForMigration';

type UnsafeExecuteOperations = 
  | { sqls: SQLiteQuery[] }
  | { loki: (_: any) => void };

type BatchOperation =
  | ['create', TableName<any>, RawRecord]
  | ['update', TableName<any>, RawRecord]
  | ['markAsDeleted', TableName<any>, RecordId]
  | ['destroyPermanently', TableName<any>, RecordId];

interface ExpoSQLiteAdapterOptions {
  schema: AppSchema;
  migrations?: SchemaMigrations;
  dbName: string;
  cipherKey: string;
  jsi?: boolean;
  onSetUpError?: (error: Error) => void;
}

/**
 * SQLite has no boolean type and expo-sqlite's bindings reject it in some
 * paths. WatermelonDB's own driver maps booleans to integers before binding, so
 * do the same.
 */
function fixArgs(args: readonly unknown[]): SQLiteArg[] {
  return args.map((value) =>
    typeof value === 'boolean' ? (value ? 1 : 0) : (value as SQLiteArg),
  );
}

/**
 * Validate and normalise a SQLCipher key.
 *
 * Rejecting a malformed key *before* the connection is opened avoids two
 * failure modes: creating an empty plaintext file that later looks like a
 * corrupted encrypted database, and reporting a confusing "database not open"
 * error instead of the real problem.
 */
function normalizeCipherKey(cipherKey: string): string {
  const hexKey = cipherKey.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error(
      'SQLCipher key must be a 64-character hex string (32 bytes). ' +
        'Refusing to open the database with a malformed key.',
    );
  }
  return hexKey;
}

/**
 * Strip a secret out of an error message.
 *
 * The `PRAGMA key` statement contains the raw key, and SQLite/JS errors can
 * quote the failing statement. `db/index.ts` reports adapter failures through
 * `onSetUpError`, so a key echoed into an error message would end up in logs.
 */
function redact(error: unknown, secret: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(secret).join('<redacted>');
}

export class ExpoSQLiteAdapter implements DatabaseAdapter {
  readonly schema: AppSchema;
  readonly dbName: string;
  readonly migrations?: SchemaMigrations;

  private db: SQLiteDatabase | null = null;
  private readonly cipherKey: string;
  private readonly onSetUpError?: (error: Error) => void;
  private isOpen = false;

  constructor(options: ExpoSQLiteAdapterOptions) {
    this.schema = options.schema;
    this.dbName = options.dbName;
    this.migrations = options.migrations;
    this.cipherKey = options.cipherKey;
    this.onSetUpError = options.onSetUpError;
  }

  async open(): Promise<void> {
    if (this.isOpen && this.db) return;

    try {
      // Fail before opening a connection: a malformed key must never leave an
      // empty, unencrypted file behind.
      normalizeCipherKey(this.cipherKey);

      // expo-sqlite silently drops unknown open options: the native
      // `OpenDatabaseOptions` records (Android/iOS, expo-sqlite 57.0.3) have no
      // `key` field and the C++ binding only wraps `sqlite3_open` — it never
      // calls `sqlite3_key`. Passing `{ key }` here therefore did nothing and
      // the database was written in plaintext. The key is applied explicitly
      // with `PRAGMA key` in `_applyEncryptionKey` instead.
      this.db = await openDatabaseAsync(this.dbName);

      await this._applyEncryptionKey();
      await this._setUpSchema();
      this.isOpen = true;
    } catch (error) {
      this.onSetUpError?.(error as Error);
      throw error;
    }
  }

  /**
   * Apply the SQLCipher key to the freshly opened connection.
   *
   * `PRAGMA key` has to be the first statement against the database: once a page
   * has been read or written, SQLCipher refuses to (re)key the file. The key is
   * passed as a raw 32-byte blob (`x'…'`) to match the 64-hex string produced by
   * `getDatabaseKey()`, so no passphrase KDF is involved.
   */
  private async _applyEncryptionKey(): Promise<void> {
    if (!this.db) throw new Error('Database not open');

    const hexKey = normalizeCipherKey(this.cipherKey);

    try {
      await this.db.execAsync(`PRAGMA key = "x'${hexKey}'"`);
    } catch (error) {
      throw new Error(`Failed to apply the SQLCipher key: ${redact(error, hexKey)}`);
    }

    // Fail loud instead of silently falling back to an unencrypted file: if
    // SQLCipher was not compiled in (the expo-sqlite plugin option
    // `useSQLCipher: true` plus a native rebuild), `PRAGMA key` is a no-op and
    // `PRAGMA cipher_version` reports nothing.
    const cipherRow = await this.db.getFirstAsync<Record<string, unknown>>(
      'PRAGMA cipher_version',
    );
    const cipherVersion = cipherRow ? Object.values(cipherRow)[0] : undefined;
    if (!cipherVersion) {
      throw new Error(
        'SQLCipher is not available in this expo-sqlite build, so the database would be stored ' +
          'unencrypted. Enable the expo-sqlite plugin option `useSQLCipher: true` and rebuild the app.',
      );
    }

    // Validate the key against the (possibly pre-existing) file. A stale key
    // makes SQLCipher fail on the first page read; surface that as a clear
    // error rather than a confusing failure deeper inside schema setup.
    try {
      await this.db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master');
    } catch (error) {
      throw new Error(
        `Failed to decrypt the database with the stored key (${redact(error, hexKey)}). ` +
          'The key may be stale, or the file may not be a SQLCipher database.',
      );
    }
  }

  /**
   * Create a fresh schema, or replay migrations for an existing database.
   *
   * Mirrors WatermelonDB's own `SQLiteAdapter`: a brand-new database is created
   * at the current schema version, while an older database replays the recorded
   * migration steps. WatermelonDB's `createTable` steps carry a `schema` object
   * (never raw SQL), so they must be encoded with the library's own
   * `encodeMigrationSteps`. The previous implementation only looked for a
   * `step.raw` property and therefore created no tables at all.
   *
   * The version is tracked with `PRAGMA user_version`, stored in the database
   * header and thus encrypted together with the rest of the SQLCipher file.
   */
  private async _setUpSchema(): Promise<void> {
    if (!this.db) throw new Error('Database not open');

    const targetVersion = this.schema.version;
    const currentVersion = await this._getCurrentVersion();

    if (currentVersion === 0) {
      // Fresh database: build the schema directly at its current version.
      await this.db.execAsync(encodeSchema(this.schema));
    } else if (currentVersion < targetVersion) {
      if (!this.migrations) {
        throw new Error(
          `Database is at schema version ${currentVersion} but the app expects ${targetVersion} and no migrations were provided`
        );
      }

      const steps = stepsForMigration({
        migrations: this.migrations,
        fromVersion: currentVersion,
        toVersion: targetVersion,
      });

      // `stepsForMigration` returns `null` when the recorded migrations do not
      // cover the version range. WatermelonDB's own adapter responds by wiping
      // and recreating the database — unacceptable for a local encrypted store
      // holding user data — and bumping `user_version` without applying anything
      // would leave the schema silently older than the app believes. Stop.
      if (!steps || steps.length === 0) {
        throw new Error(
          `No migration path from database schema version ${currentVersion} to ${targetVersion}. ` +
            'The app is missing migration steps for that range; refusing to leave the schema ' +
            'partially upgraded.',
        );
      }

      await this.db.execAsync(encodeMigrationSteps(steps));
    } else if (currentVersion > targetVersion) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than the app schema version ${targetVersion}`
      );
    }

    if (currentVersion !== targetVersion) {
      await this._setCurrentVersion(targetVersion);
    }
  }

  private async _getCurrentVersion(): Promise<number> {
    if (!this.db) return 0;

    const row = await this.db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    return row?.user_version ?? 0;
  }

  private async _setCurrentVersion(version: number): Promise<void> {
    if (!this.db) return;
    // PRAGMA values cannot be bound as parameters. `version` comes from the
    // application schema (a number), never from user input.
    await this.db.execAsync(`PRAGMA user_version = ${version}`);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      this.isOpen = false;
    }
  }

  /**
   * Reclaim space after bulk deletes.
   *
   * Deliberately *not* routed through {@link unsafeExecute}: SQLite rejects
   * `VACUUM` inside a transaction, and `unsafeExecute` runs its statements in
   * one (matching WatermelonDB's native `batch`).
   */
  async vacuum(): Promise<void> {
    if (!this.db) throw new Error('Database not open');
    await this.db.execAsync('VACUUM');
  }

  // ---- WatermelonDB Adapter interface (callback-based) ----

  find(table: TableName<any>, id: RecordId, callback: ResultCallback<RecordId | RawRecord | undefined>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    db.getFirstAsync<RawRecord>(
      `SELECT * FROM "${table}" WHERE id == ? LIMIT 1`,
      [id]
    ).then(row => {
      // `sanitizeFindResult` fills in `_status`/`_changed` and any missing
      // schema columns. Returning the raw row left models with undefined
      // fields, so it was required for correctness, not just tidiness.
      callback({ value: sanitizeFindResult(row, this.schema.tables[table]) });
    }).catch(err => {
      callback({ error: err });
    });
  }

  query(query: SerializedQuery, callback: ResultCallback<(RecordId | RawRecord)[]>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    const tableSchema = this.schema.tables[query.table];
    let sql: string;
    let args: SQLiteArg[];
    try {
      [sql, args] = encodeQuery(query);
    } catch (error) {
      callback({ error: error as Error });
      return;
    }

    db.getAllAsync<RawRecord>(sql, fixArgs(args)).then(rows => {
      callback({ value: sanitizeQueryResult(rows, tableSchema) });
    }).catch(err => {
      callback({ error: err });
    });
  }

  queryIds(query: SerializedQuery, callback: ResultCallback<RecordId[]>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    let sql: string;
    let args: SQLiteArg[];
    try {
      [sql, args] = encodeQuery(query);
    } catch (error) {
      callback({ error: error as Error });
      return;
    }

    db.getAllAsync<{ id: RecordId }>(sql, fixArgs(args)).then(rows => {
      callback({ value: rows.map(r => r.id) });
    }).catch(err => {
      callback({ error: err });
    });
  }

  unsafeQueryRaw(query: SerializedQuery, callback: ResultCallback<any[]>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    let sql: string;
    let args: SQLiteArg[];
    try {
      [sql, args] = encodeQuery(query);
    } catch (error) {
      callback({ error: error as Error });
      return;
    }

    db.getAllAsync(sql, fixArgs(args)).then(rows => {
      callback({ value: rows });
    }).catch(err => {
      callback({ error: err });
    });
  }

  count(query: SerializedQuery, callback: ResultCallback<number>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    let sql: string;
    let args: SQLiteArg[];
    try {
      [sql, args] = encodeQuery(query, true);
    } catch (error) {
      callback({ error: error as Error });
      return;
    }

    db.getAllAsync<{ count: number }>(sql, fixArgs(args)).then(rows => {
      const value = rows[0]?.count;
      // Mirrors the reference driver: a missing `count` column means the query
      // was a raw `unsafeSqlQuery`, for which counting is meaningless.
      if (value === undefined) {
        callback({ error: new Error('Invalid count query, cannot find `count` column') });
        return;
      }
      callback({ value: Number(value) });
    }).catch(err => {
      callback({ error: err });
    });
  }

  batch(operations: BatchOperation[], callback: ResultCallback<void>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    // `encodeBatch` produces the exact statements WatermelonDB's native adapter
    // runs: inserts include `id`, `_status` and `_changed`. Hand-rolling these
    // previously omitted `id`, so every insert failed its NOT NULL constraint.
    let encoded;
    try {
      encoded = encodeBatch(operations, this.schema);
    } catch (error) {
      callback({ error: error as Error });
      return;
    }

    db.withTransactionAsync(async () => {
      for (const [, , sql, argBatches] of encoded) {
        for (const args of argBatches) {
          await db.runAsync(sql, fixArgs(args));
        }
      }
    }).then(() => {
      callback({ value: undefined });
    }).catch(err => {
      callback({ error: err });
    });
  }

  getDeletedRecords(tableName: TableName<any>, callback: ResultCallback<RecordId[]>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    db.getAllAsync<{ id: RecordId }>(
      `SELECT id FROM "${tableName}" WHERE _status = 'deleted'`
    ).then(rows => {
      callback({ value: rows.map(r => r.id) });
    }).catch(err => {
      callback({ error: err });
    });
  }

  destroyDeletedRecords(
    tableName: TableName<any>,
    recordIds: RecordId[],
    callback: ResultCallback<void>
  ): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    if (recordIds.length === 0) {
      callback({ value: undefined });
      return;
    }

    const placeholders = recordIds.map(() => '?').join(', ');
    db.runAsync(
      `DELETE FROM "${tableName}" WHERE id IN (${placeholders})`,
      recordIds
    ).then(() => {
      callback({ value: undefined });
    }).catch(err => {
      callback({ error: err });
    });
  }

  unsafeLoadFromSync(jsonId: number, callback: ResultCallback<any>): void {
    callback({ error: new Error('unsafeLoadFromSync is not implemented by ExpoSQLiteAdapter') });
  }

  provideSyncJson(id: number, syncPullResultJson: string, callback: ResultCallback<void>): void {
    callback({ error: new Error('provideSyncJson is not implemented by ExpoSQLiteAdapter') });
  }

  /**
   * Drops every table and rebuilds the schema at the current version, mirroring
   * WatermelonDB's `unsafeDestroyEverything` + `setUpWithSchema`. The previous
   * implementation dropped the tables but never recreated them, leaving the
   * database unusable (`user_version` still pointed at the old schema).
   */
  unsafeResetDatabase(callback: ResultCallback<void>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    (async () => {
      const tables = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      );
      for (const { name } of tables) {
        await db.execAsync(`DROP TABLE IF EXISTS "${name}"`);
      }

      await db.execAsync('PRAGMA writable_schema = 1');
      await db.execAsync('DELETE FROM sqlite_master');
      await db.execAsync('PRAGMA user_version = 0');
      await db.execAsync('PRAGMA writable_schema = 0');

      await this._setUpSchema();

      // Safe here: no transaction is open at this point.
      await db.execAsync('VACUUM');
    })()
      .then(() => callback({ value: undefined }))
      .catch(err => callback({ error: err }));
  }

  unsafeExecute(work: UnsafeExecuteOperations, callback: ResultCallback<void>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    if ('sqls' in work) {
      // Statements run inside a single transaction, matching WatermelonDB's
      // native `batch`. `VACUUM` cannot run here — call {@link vacuum} instead.
      db.withTransactionAsync(async () => {
        for (const [sql, args] of work.sqls) {
          await db.runAsync(sql, fixArgs(args));
        }
      }).then(() => callback({ value: undefined })).catch(err => callback({ error: err }));
    } else {
      // LokiJS case - not supported
      callback({ error: new Error('LokiJS unsafeExecute not supported') });
    }
  }

  getLocal(key: string, callback: ResultCallback<string | undefined>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    db.getFirstAsync<{ value: string }>(
      'SELECT "value" FROM "local_storage" WHERE "key" = ?',
      [key]
    ).then(row => {
      callback({ value: row?.value });
    }).catch(err => {
      callback({ error: err });
    });
  }

  setLocal(key: string, value: string, callback: ResultCallback<void>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    db.runAsync(
      'INSERT OR REPLACE INTO "local_storage" ("key", "value") VALUES (?, ?)',
      [key, value]
    ).then(() => callback({ value: undefined })).catch(err => callback({ error: err }));
  }

  removeLocal(key: string, callback: ResultCallback<void>): void {
    const db = this.db;
    if (!db) {
      callback({ error: new Error('Database not open') });
      return;
    }

    db.runAsync('DELETE FROM "local_storage" WHERE "key" = ?', [key])
      .then(() => callback({ value: undefined })).catch(err => callback({ error: err }));
  }
}
