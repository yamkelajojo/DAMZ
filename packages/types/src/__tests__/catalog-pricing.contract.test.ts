import {
  CatalogItemIdSchema,
  CatalogItemSchema,
  MoneySchema,
  OrderItemSchema,
  OrderSchema,
  PaymentProviderSchema,
  PriceListSchema,
  RunnerPriceSchema,
  SwapEventSchema,
  SwapSchema,
  ExchangeOfferSchema,
} from '../index';

const EXPECTED_CATALOG_IDS = [
  'cabbage',
  'spinach',
  'cinnamon',
  'cauliflower',
  'rock_salt',
  'flour',
  'bicarbonate_of_soda',
  'grape_soda',
] as const;

const RUNNER_DID = 'did:key:z6MkDAMZContractTest123';
const ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('TC-CAT-01 — fixed eight-item catalog', () => {
  it.each(EXPECTED_CATALOG_IDS)('accepts catalog ID %s', (itemId) => {
    expect(CatalogItemIdSchema.parse(itemId)).toBe(itemId);
  });

  it('contains exactly the agreed catalog IDs', () => {
    expect([...CatalogItemIdSchema.options]).toEqual(EXPECTED_CATALOG_IDS);
  });

  it('accepts Grape Soda (Small Bottle) as a catalog reference without a price', () => {
    expect(
      CatalogItemSchema.parse({
        id: 'grape_soda',
        display_name: 'Grape Soda (Small Bottle)',
        sort_order: 8,
      }),
    ).toEqual({
      id: 'grape_soda',
      display_name: 'Grape Soda (Small Bottle)',
      sort_order: 8,
    });
  });
});

describe('ADR-0014 — converter domain contracts for the 19-table inventory', () => {
  it('validates swap, exchange-offer, and swap-event records', () => {
    expect(
      SwapSchema.parse({
        id: ORDER_ID,
        persona: 'customer',
        direction: 'btc_to_xmr',
        created_at: 1700000000,
      }),
    ).toMatchObject({ status: 'pending', direction: 'btc_to_xmr' });

    expect(
      ExchangeOfferSchema.parse({
        id: 'offer-1',
        source: 'haveno',
        direction: 'zar_to_xmr',
        price_zar_per_xmr: '45000.00',
        min_amount: '100.00',
        max_amount: '5000.00',
        fetched_at: 1700000000,
      }),
    ).toMatchObject({ source: 'haveno', direction: 'zar_to_xmr' });

    expect(
      SwapEventSchema.parse({
        id: 'event-1',
        swap_id: ORDER_ID,
        kind: 'deposit_seen',
        observed_at: 1700000000,
      }),
    ).toMatchObject({ kind: 'deposit_seen' });
  });
});

describe('ADR-0009 — canonical gateway provider values', () => {
  it('accepts the canonical AcceptXMR provider value', () => {
    expect(PaymentProviderSchema.safeParse('acceptxmr').success).toBe(true);
  });
});

describe('TC-PRICE-PREFILL-01/04 — editable suggestions are not price floors', () => {
  it.each(['14.00', '15.00', '19.00', '20.00', '0.01'])('accepts a valid money value of %s', (value) => {
    expect(MoneySchema.parse(value)).toBe(value);
  });

  it.each(['-1.00', '15.001', 'R15.00', ''])('rejects an invalid money value of %s', (value) => {
    expect(MoneySchema.safeParse(value).success).toBe(false);
  });

  it.each(['14.00', '18.00'])('accepts a Grape Soda price of %s around the R15.00 suggestion', (price) => {
    expect(
      RunnerPriceSchema.parse({
        id: `price-list:grape_soda:${price}`,
        price_list_id: 'price-list',
        item_id: 'grape_soda',
        price_zar: price,
        available: true,
      }),
    ).toMatchObject({ item_id: 'grape_soda', price_zar: price });
  });

  it.each(['19.00', '25.00'])('accepts a chosen delivery fee of %s around the R20.00 suggestion', (fee) => {
    expect(
      PriceListSchema.parse({
        id: `${RUNNER_DID}:1700000000`,
        runner_did: RUNNER_DID,
        published_at: 1700000000,
        delivery_fee_zar: fee,
        signature: 'ZHVtbXktc2lnbmF0dXJl',
        is_current: true,
      }),
    ).toMatchObject({ delivery_fee_zar: fee, signature: 'ZHVtbXktc2lnbmF0dXJl' });
  });

  it('requires a signature field on a price-list record (shape check only, not cryptographic verification)', () => {
    expect(
      PriceListSchema.safeParse({
        id: `${RUNNER_DID}:1700000000`,
        runner_did: RUNNER_DID,
        published_at: 1700000000,
        delivery_fee_zar: '19.00',
      }).success,
    ).toBe(false);
  });
});

describe('TC-PRICE-PREFILL-03 — order values are represented as snapshots', () => {
  it('accepts the agreed below-suggestion values on an order and its item snapshot', () => {
    const order = OrderSchema.parse({
      id: ORDER_ID,
      customer_did: RUNNER_DID,
      runner_did: RUNNER_DID,
      total_zar: '33.00',
      delivery_fee_zar: '19.00',
      created_at: 1700000000,
      updated_at: 1700000001,
    });
    const item = OrderItemSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440001',
      order_id: ORDER_ID,
      item_id: 'cabbage',
      display_name: 'Cabbage',
      quantity: 1,
      unit_price_zar: '14.00',
      line_total_zar: '14.00',
    });

    expect(order).toMatchObject({ total_zar: '33.00', delivery_fee_zar: '19.00' });
    expect(item).toMatchObject({ unit_price_zar: '14.00', line_total_zar: '14.00' });
  });
});
