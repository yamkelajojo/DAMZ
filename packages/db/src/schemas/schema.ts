/**
 * WatermelonDB Schema — DAMZ Database
 *
 * Matches DB_LAYOUT_AND_ARCH.md v2 exactly.
 * Single schema package, role-scoped writes.
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const TABLE_SCHEMA_SPECS = [
    // Identity (one row per device - this device's own persona)
    {
      name: 'identity',
      columns: [
        { name: 'did', type: 'string', isIndexed: true },
        { name: 'display_name', type: 'string', isOptional: true },
        { name: 'public_key', type: 'string' }, // base64
        { name: 'default_radius_km', type: 'number', isOptional: true },
        { name: 'is_available', type: 'number', isOptional: true }, // boolean as int
        { name: 'onion_address', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    },

    // Contacts (people this device has dealt with, keyed by DID)
    {
      name: 'contacts',
      columns: [
        { name: 'did', type: 'string', isIndexed: true },
        { name: 'display_name', type: 'string', isOptional: true },
        { name: 'onion_address', type: 'string', isOptional: true },
        { name: 'signal_address', type: 'string', isOptional: true },
        { name: 'signal_identity_key', type: 'string', isOptional: true },
        { name: 'last_seen_at', type: 'number', isOptional: true },
        { name: 'blocked', type: 'number', isOptional: true }, // boolean as int
        { name: 'created_at', type: 'number' },
      ],
    },

    // Catalog Items (fixed 8, seeded at install, read-only)
    {
      name: 'catalog_items',
      columns: [
        { name: 'display_name', type: 'string' },
        { name: 'sort_order', type: 'number' },
      ],
    },

    // Price Lists (Runner publishes, Customer caches)
    {
      name: 'price_lists',
      columns: [
        { name: 'runner_did', type: 'string', isIndexed: true },
        { name: 'published_at', type: 'number' },
        { name: 'delivery_fee_zar', type: 'string', isOptional: true },
        { name: 'signature', type: 'string' }, // base64 Ed25519
        { name: 'fetched_at', type: 'number', isOptional: true },
        { name: 'is_current', type: 'number' }, // boolean as int
      ],
    },

    // Runner Prices (per item per price list)
    {
      name: 'runner_prices',
      columns: [
        { name: 'price_list_id', type: 'string', isIndexed: true },
        { name: 'item_id', type: 'string', isIndexed: true },
        { name: 'price_zar', type: 'string' },
        { name: 'available', type: 'number' }, // boolean as int
      ],
    },

    // Converter (device-owned swaps and audit events; cached exchange offers)
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

    // Orders (one wide table, per-column ownership)
    {
      name: 'orders',
      columns: [
        { name: 'customer_did', type: 'string', isIndexed: true },
        { name: 'runner_did', type: 'string', isIndexed: true },
        { name: 'status', type: 'string' },
        { name: 'dispute_state', type: 'string' },
        // Money (Customer writes, Runner reads)
        { name: 'total_zar', type: 'string' },
        { name: 'delivery_fee_zar', type: 'string', isOptional: true },
        { name: 'monero_subaddress', type: 'string', isOptional: true },
        { name: 'payment_txid', type: 'string', isOptional: true },
        { name: 'paid_at', type: 'number', isOptional: true },
        { name: 'expires_at', type: 'number', isOptional: true },
        { name: 'cancelled_by', type: 'string', isOptional: true },
        { name: 'cancel_reason', type: 'string', isOptional: true },
        // Delivery (Runner writes, Customer reads)
        { name: 'delivery_geohash', type: 'string', isOptional: true },
        { name: 'proof_cid', type: 'string', isOptional: true },
        { name: 'proof_key', type: 'string', isOptional: true },
        { name: 'delivered_at', type: 'number', isOptional: true },
        { name: 'confirmed_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
        { name: 'purge_after', type: 'number', isOptional: true },
      ],
    },

    // Order Items (price snapshot at order time)
    {
      name: 'order_items',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'item_id', type: 'string', isIndexed: true },
        { name: 'display_name', type: 'string' },
        { name: 'quantity', type: 'number' },
        { name: 'unit_price_zar', type: 'string' },
        { name: 'line_total_zar', type: 'string' },
      ],
    },

    // Payment Events (audit trail)
    {
      name: 'payment_events',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'provider', type: 'string' },
        { name: 'kind', type: 'string' },
        { name: 'observed_at', type: 'number' },
        { name: 'detail', type: 'string', isOptional: true },
      ],
    },

    // Messages (decrypted body, envelope only in outbox)
    {
      name: 'messages',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'direction', type: 'string' },
        { name: 'sender_did', type: 'string', isIndexed: true },
        { name: 'recipient_did', type: 'string', isIndexed: true },
        { name: 'body', type: 'string', isOptional: true },
        { name: 'envelope', type: 'string', isOptional: true }, // base64, outbox only
        { name: 'delivery_state', type: 'string' },
        { name: 'attempts', type: 'number' },
        { name: 'sent_at', type: 'number', isOptional: true },
        { name: 'received_at', type: 'number', isOptional: true },
        { name: 'read_at', type: 'number', isOptional: true },
        { name: 'purge_after', type: 'number', isOptional: true },
      ],
    },

    // Proof Bundles (Runner writes capture, Customer writes verdict)
    {
      name: 'proof_bundles',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        // Runner-written
        { name: 'cid', type: 'string' },
        { name: 'captured_at', type: 'number', isOptional: true },
        { name: 'capture_geohash', type: 'string', isOptional: true },
        { name: 'signature_valid', type: 'number', isOptional: true }, // boolean as int
        { name: 'uploaded_at', type: 'number' },
        // Customer-written
        { name: 'verified_at', type: 'number', isOptional: true },
        { name: 'verification_result', type: 'string', isOptional: true },
        { name: 'verification_note', type: 'string', isOptional: true },
        { name: 'purge_after', type: 'number', isOptional: true },
      ],
    },

    // Wallet Metadata (independent local wallet metadata in Customer and Runner apps)
    {
      name: 'wallet_metadata',
      columns: [
        { name: 'primary_address', type: 'string', isOptional: true },
        { name: 'account_index', type: 'number' },
        { name: 'restore_height', type: 'number', isOptional: true },
        { name: 'last_sync_height', type: 'number', isOptional: true },
        { name: 'last_sync_at', type: 'number', isOptional: true },
      ],
    },

    // Mirrors (read-only on device, synced from admin service)
    // Strikes (Customer device only - Runner app excludes this table)
    {
      name: 'strikes',
      columns: [
        { name: 'subject_did', type: 'string', isIndexed: true },
        { name: 'reason', type: 'string' },
        { name: 'issued_at', type: 'number' },
        { name: 'acknowledged_at', type: 'number', isOptional: true },
      ],
    },

    // Runner Directory (both apps)
    {
      name: 'runner_directory',
      columns: [
        { name: 'runner_did', type: 'string', isIndexed: true },
        { name: 'display_name', type: 'string', isOptional: true },
        { name: 'onion_address', type: 'string' },
        { name: 'approved_at', type: 'number', isOptional: true },
        { name: 'banned_at', type: 'number', isOptional: true },
        { name: 'ban_reason', type: 'string', isOptional: true },
        { name: 'current_price_list_id', type: 'string', isOptional: true },
        { name: 'last_active_at', type: 'number', isOptional: true },
      ],
    },

    // Platform Settings (both apps)
    {
      name: 'platform_settings',
      columns: [
        { name: 'key', type: 'string', isIndexed: true },
        { name: 'value', type: 'string' },
        { name: 'updated_at', type: 'number' },
      ],
    },

    // Disputes (Customer device: draft locally, upload when Tor returns; Runner: read-only)
    {
      name: 'disputes',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'customer_did', type: 'string', isIndexed: true },
        { name: 'runner_did', type: 'string', isIndexed: true },
        { name: 'reason', type: 'string' },
        { name: 'proof_cid', type: 'string', isOptional: true },
        { name: 'proof_key_shared', type: 'number' }, // boolean as int
        { name: 'status', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'resolved_at', type: 'number', isOptional: true },
        { name: 'admin_response', type: 'string', isOptional: true },
      ],
    },

    // Sync State (local bookkeeping)
    {
      name: 'sync_state',
      columns: [
        { name: 'source', type: 'string', isIndexed: true },
        { name: 'last_success_at', type: 'number', isOptional: true },
        { name: 'cursor', type: 'string', isOptional: true },
        { name: 'last_error', type: 'string', isOptional: true },
      ],
    },
] satisfies Parameters<typeof tableSchema>[0][];

export const schema = appSchema({
  version: 2,
  tables: TABLE_SCHEMA_SPECS.map((table) => tableSchema(table)),
});

// Table names as constants for type safety
export const TABLES = {
  IDENTITY: 'identity',
  CONTACTS: 'contacts',
  CATALOG_ITEMS: 'catalog_items',
  PRICE_LISTS: 'price_lists',
  RUNNER_PRICES: 'runner_prices',
  SWAPS: 'swaps',
  EXCHANGE_OFFERS: 'exchange_offers',
  SWAP_EVENTS: 'swap_events',
  ORDERS: 'orders',
  ORDER_ITEMS: 'order_items',
  PAYMENT_EVENTS: 'payment_events',
  MESSAGES: 'messages',
  PROOF_BUNDLES: 'proof_bundles',
  WALLET_METADATA: 'wallet_metadata',
  STRIKES: 'strikes',
  RUNNER_DIRECTORY: 'runner_directory',
  PLATFORM_SETTINGS: 'platform_settings',
  DISPUTES: 'disputes',
  SYNC_STATE: 'sync_state',
} as const;

export type TableName = typeof TABLES[keyof typeof TABLES];

// Column names for each table (for query building)
export const COLUMNS = {
  [TABLES.IDENTITY]: [
    'id', 'did', 'display_name', 'public_key', 'default_radius_km',
    'is_available', 'onion_address', 'created_at', 'updated_at'
  ],
  [TABLES.CONTACTS]: [
    'id', 'did', 'display_name', 'onion_address', 'signal_address',
    'signal_identity_key', 'last_seen_at', 'blocked', 'created_at'
  ],
  [TABLES.CATALOG_ITEMS]: [
    'id', 'display_name', 'sort_order'
  ],
  [TABLES.PRICE_LISTS]: [
    'id', 'runner_did', 'published_at', 'delivery_fee_zar',
    'signature', 'fetched_at', 'is_current'
  ],
  [TABLES.RUNNER_PRICES]: [
    'id', 'price_list_id', 'item_id', 'price_zar', 'available'
  ],
  [TABLES.SWAPS]: [
    'id', 'persona', 'direction', 'status', 'btc_amount_sat', 'btc_address',
    'btc_txid', 'btc_refund_txid', 'xmr_amount_pico', 'xmr_subaddress',
    'xmr_txid', 'zar_amount_cents', 'zar_reference', 'created_at',
    'expires_at', 'completed_at', 'network_fee_btc', 'network_fee_xmr', 'service_fee_zar'
  ],
  [TABLES.EXCHANGE_OFFERS]: [
    'id', 'source', 'direction', 'price_zar_per_xmr', 'min_amount', 'max_amount',
    'payment_method', 'trader_rating', 'fetched_at', 'expires_at'
  ],
  [TABLES.SWAP_EVENTS]: [
    'id', 'swap_id', 'kind', 'observed_at', 'detail'
  ],
  [TABLES.ORDERS]: [
    'id', 'customer_did', 'runner_did', 'status', 'dispute_state',
    'total_zar', 'delivery_fee_zar', 'monero_subaddress', 'payment_txid',
    'paid_at', 'expires_at', 'cancelled_by', 'cancel_reason',
    'delivery_geohash', 'proof_cid', 'proof_key',
    'delivered_at', 'confirmed_at', 'created_at', 'updated_at', 'purge_after'
  ],
  [TABLES.ORDER_ITEMS]: [
    'id', 'order_id', 'item_id', 'display_name', 'quantity',
    'unit_price_zar', 'line_total_zar'
  ],
  [TABLES.PAYMENT_EVENTS]: [
    'id', 'order_id', 'provider', 'kind', 'observed_at', 'detail'
  ],
  [TABLES.MESSAGES]: [
    'id', 'order_id', 'direction', 'sender_did', 'recipient_did',
    'body', 'envelope', 'delivery_state', 'attempts',
    'sent_at', 'received_at', 'read_at', 'purge_after'
  ],
  [TABLES.PROOF_BUNDLES]: [
    'id', 'order_id', 'cid', 'captured_at', 'capture_geohash',
    'signature_valid', 'uploaded_at', 'verified_at',
    'verification_result', 'verification_note', 'purge_after'
  ],
  [TABLES.WALLET_METADATA]: [
    'id', 'primary_address', 'account_index', 'restore_height',
    'last_sync_height', 'last_sync_at'
  ],
  [TABLES.STRIKES]: [
    'id', 'subject_did', 'reason', 'issued_at', 'acknowledged_at'
  ],
  [TABLES.RUNNER_DIRECTORY]: [
    'id', 'runner_did', 'display_name', 'onion_address',
    'approved_at', 'banned_at', 'ban_reason',
    'current_price_list_id', 'last_active_at'
  ],
  [TABLES.PLATFORM_SETTINGS]: [
    'id', 'key', 'value', 'updated_at'
  ],
  [TABLES.DISPUTES]: [
    'id', 'order_id', 'customer_did', 'runner_did', 'reason',
    'proof_cid', 'proof_key_shared', 'status',
    'created_at', 'resolved_at', 'admin_response'
  ],
  [TABLES.SYNC_STATE]: [
    'id', 'source', 'last_success_at', 'cursor', 'last_error'
  ],
} as const;