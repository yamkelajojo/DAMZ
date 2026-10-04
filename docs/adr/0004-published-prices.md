# ADR-0004: Runners Publish Prices; An Order Freezes a Price Snapshot

**Status**: Accepted

## Context

The order lifecycle is `pending_payment → paid → accepted`, so the Customer pays **before** the Runner agrees to anything. The total therefore has to be known at placement, which rules out any flow where the Runner sets the price after seeing the order. No document in the repository described where prices come from at all.

## Decision

A Runner publishes a DID-signed price list (price and availability per catalog item) on their onion service. A Customer caches it, orders against the cache, and the order stores a frozen snapshot of the unit prices it was placed against. `orders.total_zar` is derived from that snapshot and never changes afterwards.

## Consequences

- **Considered options**: A two-phase request → quote → pay flow (handles haggling and out-of-stock, but adds a round trip and a state to the machine, and the Customer is stuck waiting on a Runner who may never reply); no price up front, Runner sets the total afterwards (a Customer can be overcharged with no exit).
- The Customer app must have fetched a Runner's list at least once before ordering — ordering is offline-capable *from cache*, not from nothing.
- A Runner's price change never affects an order already placed.
- The frozen snapshot means disputes can always reconstruct what the Customer agreed to pay.
- The signature means a relay or impostor cannot substitute its own price list.