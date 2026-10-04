#!/usr/bin/env bun
/**
 * Schema Validation Script
 * Enforces:
 * 1. Every table has explicit owner (customer, runner, admin)
 * 2. Cross-table references respect bounded-scope (admin DB must not reference orders)
 * 3. Every table storing user data has purge_after column or documented exception
 * 4. Every encrypted column is annotated in comments
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA_FILE = join(import.meta.dir, '../src/schemas/schema.ts');

interface TableDef {
  name: string;
  owner: 'customer' | 'runner' | 'admin' | 'shared';
  columns: ColumnDef[];
  purgeAfter?: boolean;
  purgeException?: string;
}

interface ColumnDef {
  name: string;
  type: string;
  encrypted?: boolean;
  comment?: string;
  references?: string; // table.column
}

const schema = readFileSync(SCHEMA_FILE, 'utf-8');

function parseSchema(source: string): TableDef[] {
  const tables: TableDef[] = [];
  
  // Regex to match CREATE TABLE statements with annotations
  const tableRegex = /CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\);/g;
  let match;
  
  while ((match = tableRegex.exec(source)) !== null) {
    const name = match[1];
    const body = match[2];
    
    // Extract owner annotation
    const ownerMatch = body.match(/--\s*✍️\s*Owner:\s*(\w+)/);
    const mirrorMatch = body.match(/--\s*👁️\s*(\w+)/);
    
    let owner: TableDef['owner'] = 'shared';
    if (ownerMatch) {
      const o = ownerMatch[1].toLowerCase();
      if (o.includes('customer') && o.includes('runner')) owner = 'shared';
      else if (o.includes('customer')) owner = 'customer';
      else if (o.includes('runner')) owner = 'runner';
      else if (o.includes('admin')) owner = 'admin';
      else if (o.includes('app bundle') || o.includes('both')) owner = 'shared';
    }
    
    // Parse columns
    const columns: ColumnDef[] = [];
    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('CONSTRAINT') || trimmed.startsWith('UNIQUE') || trimmed.startsWith('CHECK') || trimmed.startsWith('PRIMARY KEY') || trimmed.startsWith('FOREIGN KEY')) continue;
      
      const colMatch = trimmed.match(/^(\w+)\s+(\w+(?:\([^)]+\))?)(?:\s+(.*))?/);
      if (colMatch) {
        const [, colName, colType, rest] = colMatch;
        const encrypted = rest?.includes('ENCRYPTED') || colName.includes('key') || colName.includes('seed') || colName.includes('envelope') || colName.includes('signature');
        const commentMatch = rest?.match(/--\s*(.*)/);
        const refMatch = rest?.match(/REFERENCES\s+(\w+)\.(\w+)/);
        
        columns.push({
          name: colName,
          type: colType,
          encrypted,
          comment: commentMatch?.[1],
          references: refMatch ? `${refMatch[1]}.${refMatch[2]}` : undefined,
        });
      }
    }
    
    // Check for purge_after
    const purgeAfter = columns.some(c => c.name === 'purge_after');
    const purgeException = purgeAfter ? undefined : body.match(/--\s*NO PURGE:\s*(.*)/)?.[1];
    
    tables.push({ name, owner, columns, purgeAfter, purgeException });
  }
  
  return tables;
}

function validate(tables: TableDef[]): string[] {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  for (const table of tables) {
    // 1. Every table has explicit owner
    if (table.owner === 'shared' && !table.name.match(/^(catalog_items|exchange_offers|platform_settings|runner_directory|sync_state)$/)) {
      warnings.push(`[${table.name}] Owner is 'shared' — verify this is intentional`);
    }
    
    // 2. Bounded-scope: admin tables must not reference orders/messages/proofs (except disputes)
    if (table.owner === 'admin') {
      for (const col of table.columns) {
        if (col.references) {
          const [refTable] = col.references.split('.');
          if (['orders', 'order_items', 'messages', 'proof_bundles', 'payment_events', 'swaps', 'swap_events'].includes(refTable)) {
            if (!(table.name === 'disputes' && ['order_id', 'proof_cid', 'proof_key'].includes(col.name))) {
              errors.push(`[${table.name}.${col.name}] Admin table references user-data table '${refTable}' — violates bounded-scope (ADR-0001, ADR-0041)`);
            }
          }
        }
      }
    }
    
    // 3. Every table storing user data has purge_after or documented exception
    const isUserDataTable = !table.name.match(/^(catalog_items|exchange_offers|platform_settings|runner_directory|sync_state|admin_identity|runner_registry|strikes)$/);
    if (isUserDataTable && !table.purgeAfter) {
      if (!table.purgeException) {
        errors.push(`[${table.name}] Missing purge_after column and no documented exception`);
      } else {
        warnings.push(`[${table.name}] No purge_after — exception: ${table.purgeException}`);
      }
    }
    
    // 4. Every encrypted column annotated
    for (const col of table.columns) {
      if (col.encrypted && !col.comment?.includes('ENCRYPTED') && !col.comment?.includes('encrypted') && !col.comment?.includes('SQLCipher') && !col.comment?.includes('secure store')) {
        warnings.push(`[${table.name}.${col.name}] Likely encrypted but missing encryption annotation in comment`);
      }
    }
    
    // 5. Verify critical tables exist
    const criticalTables = ['identity', 'contacts', 'catalog_items', 'price_lists', 'runner_prices', 'orders', 'order_items', 'messages', 'proof_bundles', 'wallet_metadata', 'strikes', 'runner_directory', 'platform_settings', 'disputes', 'sync_state', 'swaps', 'exchange_offers', 'swap_events', 'payment_events'];
    for (const critical of criticalTables) {
      if (!tables.some(t => t.name === critical)) {
        errors.push(`Missing critical table: ${critical}`);
      }
    }
  }
  
  // Cross-table reference validation
  const tableNames = new Set(tables.map(t => t.name));
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.references) {
        const [refTable] = col.references.split('.');
        if (!tableNames.has(refTable)) {
          errors.push(`[${table.name}.${col.name}] References non-existent table: ${refTable}`);
        }
      }
    }
  }
  
  return [...errors, ...warnings];
}

function main() {
  console.log('🔍 Validating database schema...\n');
  
  const tables = parseSchema(schema);
  const issues = validate(tables);
  
  const errors = issues.filter(i => !i.startsWith('[') || i.includes('ERROR'));
  const warnings = issues.filter(i => i.startsWith('[') && !i.includes('ERROR'));
  
  if (errors.length > 0) {
    console.error('❌ ERRORS:');
    for (const e of errors) console.error(`  ${e}`);
  }
  
  if (warnings.length > 0) {
    console.warn('\n⚠️  WARNINGS:');
    for (const w of warnings) console.warn(`  ${w}`);
  }
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ All schema validations passed!');
  }
  
  console.log(`\n📊 Summary: ${tables.length} tables, ${errors.length} errors, ${warnings.length} warnings`);
  
  process.exit(errors.length > 0 ? 1 : 0);
}

main();