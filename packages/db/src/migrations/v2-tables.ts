/**
 * Frozen v2 table definitions.
 *
 * A migration must describe the schema *as it was when that version shipped*, so
 * these specs are a deliberate snapshot rather than a reference to
 * `TABLE_SCHEMA_SPECS`. Reading the live schema would make an old migration drift
 * every time a column is added:
 *
 *   - v2 creates `swaps` from the live spec, so once v3 added
 *     `swaps.purge_after` the v2 step started creating that column too;
 *   - the v3 `addColumns` step would then run `alter table "swaps" add
 *     "purge_after"` on a table that already has it — a duplicate-column error
 *     that breaks every v1 → v3 upgrade.
 *
 * Never add a column here. Add it to the current schema (`schemas/schema.ts`) and
 * to a new migration instead.
 */

import { tableSchema } from '@nozbe/watermelondb';

/** Converter tables introduced by schema v2 (ADR-0043 / OQ-SCHEMA-001). */
export const V2_TABLE_SPECS = [
  {
    name: 'swaps',
    columns: [
      { name: 'persona', type: 'string' },
      { name: 'direction', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'btc_amount_sat', type: 'number', isOptional: true },
      { name: 'btc_address', type: 'string', isOptional: true },
      { name: 'btc_txid', type: 'string', isOptional: true },
      { name: 'btc_refund_txid', type: 'string', isOptional: true },
      { name: 'xmr_amount_pico', type: 'number', isOptional: true },
      { name: 'xmr_subaddress', type: 'string', isOptional: true },
      { name: 'xmr_txid', type: 'string', isOptional: true },
      { name: 'zar_amount_cents', type: 'number', isOptional: true },
      { name: 'zar_reference', type: 'string', isOptional: true },
      { name: 'created_at', type: 'number' },
      { name: 'expires_at', type: 'number', isOptional: true },
      { name: 'completed_at', type: 'number', isOptional: true },
      { name: 'network_fee_btc', type: 'number', isOptional: true },
      { name: 'network_fee_xmr', type: 'number', isOptional: true },
      { name: 'service_fee_zar', type: 'number', isOptional: true },
    ],
  },
  {
    name: 'exchange_offers',
    columns: [
      { name: 'source', type: 'string', isIndexed: true },
      { name: 'direction', type: 'string' },
      { name: 'price_zar_per_xmr', type: 'string' },
      { name: 'min_amount', type: 'string' },
      { name: 'max_amount', type: 'string' },
      { name: 'payment_method', type: 'string', isOptional: true },
      { name: 'trader_rating', type: 'number', isOptional: true },
      { name: 'fetched_at', type: 'number' },
      { name: 'expires_at', type: 'number', isOptional: true },
    ],
  },
  {
    name: 'swap_events',
    columns: [
      { name: 'swap_id', type: 'string', isIndexed: true },
      { name: 'kind', type: 'string' },
      { name: 'observed_at', type: 'number' },
      { name: 'detail', type: 'string', isOptional: true },
    ],
  },
] satisfies Parameters<typeof tableSchema>[0][];
