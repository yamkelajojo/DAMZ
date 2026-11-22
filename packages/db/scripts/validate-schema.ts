#!/usr/bin/env bun
/**
 * Schema Validation Script
 *
 * Enforces the thresholds in `DB_LAYOUT_AND_ARCH.md` §6 (retention) and ADR-0043:
 * 1. Exactly 19 client tables present (OQ-SCHEMA-003)
 * 2. Every table has an explicit owner (customer, runner, admin, shared)
 * 3. Every table has a deliberate retention decision (see RETENTION below)
 * 4. Likely-sensitive columns are flagged for SQLCipher coverage
 * 5. Indexed foreign-key-like columns reference a known table
 *
 * Validates the ACTUAL TypeScript schema (`TABLE_SCHEMA_SPECS`), not regex-parsed
 * SQL.
 *
 * ### Retention is per-table, not a blanket rule
 *
 * The previous version demanded `purge_after` on every table except a hard-coded
 * list of five, which contradicted §6 and left the script permanently red (11
 * errors), so it could no longer flag a *new* violation. §6 gives each table a
 * mechanism:
 *
 * | Data                                  | Mechanism                  |
 * |---------------------------------------|----------------------------|
 * | Messages / orders / swaps             | own `purge_after` deadline |
 * | Order & swap children                 | cascade with the parent    |
 * | Mirrors (strikes, directory, settings)| replaced on each sync      |
 * | Device-owned (identity, wallet, …)    | user-initiated wipe        |
 *
 * A table that is in none of those buckets is an error: adding a table must force
 * a retention decision rather than defaulting to "forever".
 */

import { TABLE_SCHEMA_SPECS, TABLES } from '../src/schemas/schema';

/** Tables that must carry a per-row `purge_after` deadline (`DB_LAYOUT_AND_ARCH.md` §6). */
const REQUIRES_PURGE_AFTER: Record<string, string> = {
  orders: '90 days after completion; frozen while dispute_state = open',
  messages: '30 days after completion',
  swaps: '90 days after completion, once terminal',
};

/**
 * Tables removed by another mechanism, with the reason. Every table in the schema
 * must appear here or in `REQUIRES_PURGE_AFTER`.
 */
const RETAINED_BY_OTHER_MEANS: Record<string, string> = {
  order_items: 'cascades with its order (order_id)',
  payment_events: 'cascades with its order (order_id)',
  proof_bundles: 'cascades with its order; the blob is unpinned separately',
  disputes: 'cascades with its order',
  swap_events: 'cascades with its swap (swap_id)',
  identity: 'device-owned; removed by user-initiated wipe',
  wallet_metadata: 'device-owned; removed by user-initiated wipe (ADR-0029)',
  contacts: 'device-owned; removed by user-initiated wipe',
  price_lists: 'superseded by the next published list',
  runner_prices: 'replaced together with its price list',
  catalog_items: 'refreshed from the shared catalog on sync',
  exchange_offers: 'cached exchange quotes, refreshed on fetch',
  strikes: 'sync mirror, replaced on each successful sync',
  runner_directory: 'sync mirror, replaced on each successful sync',
  platform_settings: 'sync mirror, replaced on each successful sync',
  sync_state: 'sync bookkeeping, replaced on each successful sync',
};

const TABLE_OWNERS: Record<string, 'customer' | 'runner' | 'admin' | 'shared'> = {
  identity: 'shared',
  contacts: 'shared',
  catalog_items: 'shared',
  price_lists: 'runner',
  runner_prices: 'runner',
  swaps: 'shared',
  exchange_offers: 'shared',
  swap_events: 'shared',
  orders: 'shared',
  order_items: 'shared',
  payment_events: 'shared',
  messages: 'shared',
  proof_bundles: 'shared',
  wallet_metadata: 'shared',
  strikes: 'customer',
  runner_directory: 'shared',
  platform_settings: 'shared',
  disputes: 'customer',
  sync_state: 'shared',
};

const CLIENT_TABLE_NAMES: string[] = Object.values(TABLES);

/**
 * Singular `_id` prefix → the table it references. `order_id` → `orders`, and so
 * on; the mapping is explicit because the plural of `item` is `catalog_items`,
 * which no `+ 's'` rule would guess.
 */
const FK_TARGET_SINGULARS: Record<string, string> = {
  price_list: 'price_lists',
  item: 'catalog_items',
  swap: 'swaps',
  order: 'orders',
  runner: 'runner_directory',
  message: 'messages',
  proof: 'proof_bundles',
};

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function validate(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Verify exactly 19 client tables (ADR-0043 OQ-SCHEMA-003)
  const specTableNames = TABLE_SCHEMA_SPECS.map((table) => table.name);
  if (specTableNames.length !== 19) {
    errors.push(
      `Expected exactly 19 client tables, found ${specTableNames.length}: ${specTableNames.join(', ')}`,
    );
  }

  for (const expected of CLIENT_TABLE_NAMES) {
    if (!specTableNames.includes(expected)) {
      errors.push(`Missing required client table in schema: ${expected}`);
    }
  }

  for (const spec of specTableNames) {
    if (!CLIENT_TABLE_NAMES.includes(spec)) {
      warnings.push(`Unexpected table in schema specs: ${spec}`);
    }
  }

  // 2. Per-table checks
  for (const spec of TABLE_SCHEMA_SPECS) {
    const tableName = spec.name;
    const columnNames = spec.columns.map((column) => column.name);

    if (!TABLE_OWNERS[tableName]) {
      errors.push(`[${tableName}] No explicit owner defined`);
    }

    // 3. Retention decision — exactly one bucket per table.
    const requiresDeadline = Object.hasOwn(REQUIRES_PURGE_AFTER, tableName);
    const retainedOtherwise = Object.hasOwn(RETAINED_BY_OTHER_MEANS, tableName);
    const hasPurgeAfter = columnNames.includes('purge_after');

    if (requiresDeadline && !hasPurgeAfter) {
      errors.push(
        `[${tableName}] Missing purge_after (${REQUIRES_PURGE_AFTER[tableName]})`,
      );
    }
    if (!requiresDeadline && !retainedOtherwise) {
      errors.push(
        `[${tableName}] No retention decision. Add it to REQUIRES_PURGE_AFTER ` +
          'or RETAINED_BY_OTHER_MEANS in this script, with the mechanism.',
      );
    }
    if (hasPurgeAfter && !requiresDeadline) {
      warnings.push(
        `[${tableName}] Declares purge_after but nothing purges it (see ` +
          'RETAINED_BY_OTHER_MEANS); remove the column or give it a deadline owner',
      );
    }

    // 4. Likely-sensitive columns — SQLCipher covers the whole file, so this is a
    // reminder to keep the file encrypted and to never log these values.
    const likelySensitive = columnNames.filter(
      (name) =>
        name.includes('key') ||
        name.includes('seed') ||
        name.includes('envelope') ||
        name.includes('signature') ||
        name.includes('cid') ||
        name === 'tor_control_auth',
    );
    for (const columnName of likelySensitive) {
      warnings.push(
        `[${tableName}.${columnName}] Likely sensitive — ensure SQLCipher covers this column`,
      );
    }
  }

  // 5. Indexed foreign-key-like columns must name a known table.
  for (const spec of TABLE_SCHEMA_SPECS) {
    for (const column of spec.columns) {
      if (!column.isIndexed || !column.name.endsWith('_id')) continue;

      const singular = column.name.replace(/_id$/, '');
      const target = FK_TARGET_SINGULARS[singular];
      if (!target || !CLIENT_TABLE_NAMES.includes(target)) {
        warnings.push(
          `[${spec.name}.${column.name}] Indexed foreign-key-like column references unknown table: ${singular}`,
        );
      }
    }
  }

  return { errors, warnings };
}

function main() {
  const log = (msg: string) => (globalThis as { console?: Console }).console?.log?.(msg);
  const error = (msg: string) => (globalThis as { console?: Console }).console?.error?.(msg);
  const warn = (msg: string) => (globalThis as { console?: Console }).console?.warn?.(msg);
  const exit = (code: number) => (globalThis as { process?: { exit?: (code: number) => void } }).process?.exit?.(code);

  log('🔍 Validating database schema (TypeScript source)...\n');

  const { errors, warnings } = validate();

  if (errors.length > 0) {
    error('❌ ERRORS:');
    for (const message of errors) error(`  ${message}`);
  }

  if (warnings.length > 0) {
    warn('\n⚠️  WARNINGS:');
    for (const message of warnings) warn(`  ${message}`);
  }

  if (errors.length === 0) {
    log('✅ No schema violations.');
  }

  log(
    `\n📊 Summary: ${TABLE_SCHEMA_SPECS.length} tables, ${errors.length} errors, ${warnings.length} warnings`,
  );

  exit(errors.length > 0 ? 1 : 0);
}

main();
