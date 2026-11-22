jest.mock(
  '@nozbe/watermelondb',
  () => ({
    Model: class Model {},
    appSchema: (definition: unknown) => definition,
    tableSchema: (definition: unknown) => definition,
  }),
  { virtual: true },
);

jest.mock(
  '@nozbe/watermelondb/decorators',
  () => {
    const decorator = () => () => undefined;
    return {
      field: decorator,
      text: decorator,
      date: decorator,
      readonly: decorator,
      children: decorator,
    };
  },
  { virtual: true },
);

import { CUSTOMER_MODELS, MODELS, RUNNER_MODELS } from '../models';

const tableConstants = (require('../models') as { TABLES?: Record<string, string> }).TABLES;

const EXPECTED_CLIENT_MODEL_TABLES = [
  'identity',
  'contacts',
  'catalog_items',
  'price_lists',
  'runner_prices',
  'orders',
  'order_items',
  'payment_events',
  'messages',
  'proof_bundles',
  'wallet_metadata',
  'strikes',
  'runner_directory',
  'platform_settings',
  'disputes',
  'sync_state',
  'swaps',
  'exchange_offers',
  'swap_events',
];

describe('REQ-DB-01 — WatermelonDB model inventory', () => {
  it('has model classes for the complete 19-table client inventory', () => {
    expect(MODELS.map((model) => model.table).sort()).toEqual(
      [...EXPECTED_CLIENT_MODEL_TABLES].sort(),
    );
  });

  it('gives the Customer app all client models and keeps Runner strikes excluded', () => {
    expect(CUSTOMER_MODELS).toEqual(MODELS);
    expect(CUSTOMER_MODELS.map((model) => model.table)).toContain('wallet_metadata');
    expect(RUNNER_MODELS.map((model) => model.table)).toContain('wallet_metadata');
    expect(RUNNER_MODELS.map((model) => model.table)).not.toContain('strikes');
  });

  it('exports the table constants consumed by database initialization', () => {
    expect(tableConstants).toBeDefined();
    expect(Object.values(tableConstants ?? {}).sort()).toEqual(
      [...EXPECTED_CLIENT_MODEL_TABLES].sort(),
    );
    expect(tableConstants?.CATALOG_ITEMS).toBe('catalog_items');
  });
});

/**
 * Association inventory.
 *
 * Each entry is `<assocName>:<type>:<column>`, where `column` is the
 * `foreignKey` (has_many) or `key` (belongs_to). Associations are only used by
 * `Q.on(...)` joins, so a wrong one fails silently or with a confusing SQL
 * error rather than at startup:
 *
 *  - `identity.contacts` (`has_many`, `did`) joined contacts whose DID equalled
 *    this device's own DID — always empty.
 *  - `contact.identity` (`belongs_to`, `did`) resolved a peer DID against this
 *    device's identity row.
 *  - `price_list.orders` (`has_many`, `price_list_id`) referenced a column that
 *    `orders` does not have.
 */
const EXPECTED_ASSOCIATIONS: Record<string, string[]> = {
  identity: [],
  contacts: ['messages:has_many:sender_did', 'ordersAsCustomer:has_many:customer_did', 'ordersAsRunner:has_many:runner_did'],
  catalog_items: ['orderItems:has_many:item_id', 'runnerPrices:has_many:item_id'],
  price_lists: ['runnerPrices:has_many:price_list_id'],
  runner_prices: ['item:belongs_to:item_id', 'priceList:belongs_to:price_list_id'],
  swaps: ['events:has_many:swap_id'],
  exchange_offers: [],
  swap_events: ['swap:belongs_to:swap_id'],
  orders: [
    'disputes:has_many:order_id',
    'items:has_many:order_id',
    'messages:has_many:order_id',
    'paymentEvents:has_many:order_id',
    'proofBundles:has_many:order_id',
  ],
  order_items: ['item:belongs_to:item_id', 'order:belongs_to:order_id'],
  payment_events: ['order:belongs_to:order_id'],
  messages: ['order:belongs_to:order_id'],
  proof_bundles: ['order:belongs_to:order_id'],
  wallet_metadata: [],
  strikes: [],
  runner_directory: ['priceLists:has_many:runner_did'],
  platform_settings: [],
  disputes: [],
  sync_state: [],
};

describe('REQ-DB-01 — WatermelonDB association inventory', () => {
  it.each(MODELS.map((model) => model.table))(
    'declares only real associations on the %s table',
    (table) => {
      const model = MODELS.find((candidate) => candidate.table === table);
      const declared = Object.entries(model?.associations ?? {})
        .map(([name, association]: [string, any]) => {
          const column = association.type === 'has_many' ? association.foreignKey : association.key;
          return `${name}:${association.type}:${column}`;
        })
        .sort();

      expect(declared).toEqual([...(EXPECTED_ASSOCIATIONS[table] ?? [])].sort());
    },
  );

  it('covers every model in the inventory', () => {
    expect(Object.keys(EXPECTED_ASSOCIATIONS).sort()).toEqual(
      MODELS.map((model) => model.table).sort(),
    );
  });
});
