jest.mock(
  '@nozbe/watermelondb',
  () => ({
    appSchema: ({ version, tables }: { version: number; tables: { name: string; columns: any[] }[] }) => ({
      version,
      tables: Object.fromEntries(
        tables.map((table) => [
          table.name,
          {
            name: table.name,
            columns: Object.fromEntries(table.columns.map((column) => [column.name, column])),
            columnArray: table.columns,
          },
        ]),
      ),
    }),
    tableSchema: ({ name, columns }: { name: string; columns: any[] }) => ({ name, columns, columnArray: columns }),
  }),
  { virtual: true },
);

import { schema } from '../schemas/schema';

const EXPECTED_CLIENT_TABLES = [
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

type SchemaColumn = { name: string; type: string; isOptional?: boolean };
type SchemaTable = {
  name: string;
  columns: Record<string, SchemaColumn>;
  columnArray: SchemaColumn[];
};

const tables = Object.values((schema as { tables: Record<string, SchemaTable> }).tables);
const findTable = (name: string): SchemaTable => {
  const table = tables.find((candidate) => candidate.name === name);
  if (!table) throw new Error(`Missing schema table: ${name}`);
  return table;
};

describe('REQ-DB-01 / TC-CAT-01 — client database inventory', () => {
  it('contains exactly the agreed 19 client tables', () => {
    expect(tables.map(({ name }) => name).sort()).toEqual([...EXPECTED_CLIENT_TABLES].sort());
  });

  it('does not put the Admin wipe queue in the client schema', () => {
    expect(tables.map(({ name }) => name)).not.toContain('wipe_pending');
  });

  it('stores the catalog as references only, without item prices or delivery fees', () => {
    const catalogColumns = findTable('catalog_items').columnArray.map(({ name }) => name);
    expect(catalogColumns).toEqual(['display_name', 'sort_order']);
    expect(catalogColumns).not.toContain('price_zar');
    expect(catalogColumns).not.toContain('delivery_fee_zar');
  });

  it('stores the signed chosen fee and item prices on a price list, not as catalog defaults', () => {
    const priceListColumns = findTable('price_lists').columnArray;
    const priceListColumnNames = priceListColumns.map(({ name }) => name);
    const deliveryFee = priceListColumns.find(({ name }) => name === 'delivery_fee_zar');
    expect(priceListColumnNames).toEqual(
      expect.arrayContaining(['runner_did', 'published_at', 'delivery_fee_zar', 'signature']),
    );
    expect(deliveryFee).toMatchObject({ type: 'string', isOptional: true });
    expect(findTable('runner_prices').columnArray.map(({ name }) => name)).toContain('price_zar');
  });

  it('has non-secret wallet metadata only', () => {
    const walletColumns = findTable('wallet_metadata').columnArray.map(({ name }) => name);
    expect(walletColumns).toEqual([
      'primary_address',
      'account_index',
      'restore_height',
      'last_sync_height',
      'last_sync_at',
    ]);
    expect(walletColumns).not.toContain('seed');
    expect(walletColumns).not.toContain('spend_key');
    expect(walletColumns).not.toContain('private_view_key');
  });

  it('persists chosen values in the order snapshot columns', () => {
    expect(findTable('orders').columnArray.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['total_zar', 'delivery_fee_zar']),
    );
    expect(findTable('order_items').columnArray.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['display_name', 'quantity', 'unit_price_zar', 'line_total_zar']),
    );
  });
});

describe('TC-DB-RETENTION-01 — purge deadlines declared in the schema', () => {
  // `purgeExpiredData` reads `purge_after` on these tables, and the v3 migration
  // hard-codes the swaps column, so the schema is the contract for both.
  it.each(['orders', 'messages', 'proof_bundles', 'swaps'])(
    'declares an optional numeric purge_after on %s',
    (tableName) => {
      const column = findTable(tableName).columns.purge_after;
      expect(column).toBeDefined();
      expect(column.type).toBe('number');
      expect(column.isOptional).toBe(true);
    },
  );

  it('is at schema version 3', () => {
    expect((schema as { version: number }).version).toBe(3);
  });
});
