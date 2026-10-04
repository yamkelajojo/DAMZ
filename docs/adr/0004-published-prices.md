# ADR-0004: Runners Publish Prices; An Order Freezes a Price Snapshot

**Status**: Accepted

## Context

The order lifecycle is `pending_payment → paid → accepted`, so the Customer pays **before** the Runner agrees to anything. The total therefore has to be known at placement, which rules out any flow where the Runner sets the price after seeing the order. No document in the repository described where prices come from at all.

## Decision

A Runner publishes a DID-signed price list (price and availability per catalog item, plus an optional delivery fee) on their onion service. A Customer caches it and orders against the cache. The order stores the chosen unit-price snapshot in `order_items` and, when set, the chosen delivery-fee snapshot in `orders.delivery_fee_zar`; `orders.total_zar` is derived from those placed-order values and never changes afterwards.

## Consequences

- **Considered options**: A two-phase request → quote → pay flow (handles haggling and out-of-stock, but adds a round trip and a state to the machine, and the Customer is stuck waiting on a Runner who may never reply); no price up front, Runner sets the total afterwards (a Customer can be overcharged with no exit).
- The Customer app must have fetched a Runner's list at least once before ordering — ordering is offline-capable *from cache*, not from nothing.
- A Runner's price change never affects an order already placed.
- The frozen snapshot means disputes can always reconstruct what the Customer agreed to pay.
- The signature means a relay or impostor cannot substitute its own price list.

## Later clarification — editable prefill suggestions (C20)

The Runner's price-list editor prefills **R15.00** for `Grape Soda (Small Bottle)` and
**R20.00** in the delivery-fee field. These are suggestions to speed entry, not fixed prices,
required values, or minimums. The Runner can edit either value to a lower or higher valid
amount before signing and publishing; neither suggestion is a price floor. Only the values
the Runner explicitly chooses and signs are part of the published list. The Customer
caches those signed values and freezes them in an order snapshot; later edits do not change
an order already placed.

This clarification does not change ADR-0004's signed-list or snapshot decision and adds no
schema column, database default, migration, or Admin price control. `catalog_items` remains
the fixed eight-item reference catalog; per-Runner prices and fees remain in
`runner_prices.price_zar` and `price_lists.delivery_fee_zar`.
