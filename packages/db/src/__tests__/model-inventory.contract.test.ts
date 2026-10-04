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
