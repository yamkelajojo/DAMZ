/**
 * Type shims for WatermelonDB internals.
 *
 * WatermelonDB ships its JavaScript with hand-written `.d.ts` files that only
 * cover the *public* adapter surface. The modules below are part of the surface
 * the library's own `SQLiteAdapter` depends on (`require('./encodeQuery')`,
 * `require('../common')`, …) but they have no declarations of their own, so
 * `ExpoSQLiteAdapter` — which reuses them instead of re-implementing SQL
 * generation — needs them declared here.
 *
 * The signatures mirror the upstream sources:
 *   - `src/adapters/sqlite/encodeQuery/index.js`
 *   - `src/adapters/sqlite/encodeBatch/index.js`
 *   - `src/adapters/common.js`
 */

declare module '@nozbe/watermelondb/adapters/sqlite/encodeSchema' {
  export function encodeSchema(schema: { tables: unknown; unsafeSql?: unknown }): string;
  export function encodeCreateIndices(schema: { tables: unknown; unsafeSql?: unknown }): string;
  export function encodeDropIndices(schema: { tables: unknown; unsafeSql?: unknown }): string;
  export function encodeMigrationSteps(steps: unknown[]): string;
}

declare module '@nozbe/watermelondb/adapters/sqlite/encodeQuery' {
  import type { SerializedQuery } from '@nozbe/watermelondb/Query';
  import type { SQLiteArg } from '@nozbe/watermelondb/adapters/sqlite/type';

  /**
   * Compiles a serialized query into SQL. With `countMode` it emits
   * `select count(*) as "count" from …` instead of `select "table".* from …`.
   *
   * When `query.description.sql` is set (an `unsafeSqlQuery`), the raw SQL is
   * returned verbatim and `countMode` is ignored — the "count" column will be
   * absent, which is why `count()` fails loud when it cannot find one.
   */
  export default function encodeQuery(
    query: SerializedQuery,
    countMode?: boolean,
  ): [string, SQLiteArg[]];
}

declare module '@nozbe/watermelondb/adapters/sqlite/encodeBatch' {
  import type { AppSchema } from '@nozbe/watermelondb';
  import type { SQLiteArg } from '@nozbe/watermelondb/adapters/sqlite/type';

  /**
   * `[cacheBehavior, table, sql, argBatches]` where `cacheBehavior` is
   * `-1` (remove), `0` (ignore) or `1` (add). Batches of >= 1000 operations are
   * wrapped with index drops/creates.
   */
  export type EncodedBatchOperation = [
    cacheBehavior: number,
    table: string | null,
    sql: string,
    argBatches: SQLiteArg[][],
  ];

  export default function encodeBatch(
    operations: unknown[],
    schema: AppSchema,
  ): EncodedBatchOperation[];
}

declare module '@nozbe/watermelondb/adapters/common' {
  /**
   * Fills in schema defaults (`_status`, `_changed`, missing columns) on a raw
   * record read from SQLite. Without this, models receive incomplete rows.
   */
  export function sanitizeFindResult(dirtyRecord: unknown, tableSchema: unknown): any;
  export function sanitizeQueryResult(dirtyRecords: unknown[], tableSchema: unknown): any[];
  export function validateTable(tableName: string, schema: unknown): void;
  export function validateAdapter(adapter: unknown): void;
  export function devSetupCallback(
    result: { error?: Error },
    onSetUpError?: (error: Error) => void,
  ): void;
}
