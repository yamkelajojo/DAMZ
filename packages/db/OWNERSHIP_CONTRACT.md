# Database Ownership Contract

**Version**: 1.0
**Status**: Approved
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

---

## 1. Overview

This document defines the **enforceable ownership contract** for the DAMZ database schema. It extends the ownership annotations (✍️ Owner / 👁️ Mirror) in `DB_LAYOUT_AND_ARCH.md` into a machine-checkable contract.

**Core Principle**: Every column has exactly one writer. All other devices/services are read-only mirrors.

This contract covers the **19 client-side WatermelonDB tables**. The Rust Admin service
uses a separate server-side schema and API contract (ADR-0007, ADR-0043); Admin-role
entries here describe authority for mirrored client records, not a shared WatermelonDB
schema.

---

## 2. Write Permission Matrix

| Table | Column | Writer | Readers |
|-------|--------|--------|---------|
| `identity` | all | **Device itself** (both apps) | — |
| `contacts` | all | **Device itself** | — |
| `catalog_items` | all | **App bundle** (seed) | Customer, Runner |
| `price_lists` | all | **Runner** (own) | Customer (cached) |
| `runner_prices` | all | **Runner** (own) | Customer (cached) |
| `orders` | `id`, `customer_did`, `runner_did`, `created_at` | **Customer** (at placement) | Runner |
| `orders` | `status`, `dispute_state`, `delivery_geohash`, `proof_cid`, `proof_key`, `delivered_at`, `confirmed_at`, `updated_at`, `purge_after` | **Runner** | Customer |
| `orders` | `total_zar`, `delivery_fee_zar`, `monero_subaddress`, `payment_txid`, `paid_at`, `expires_at`, `cancelled_by`, `cancel_reason` | **Customer** | Runner |
| `order_items` | all | **Customer** (at placement) | Runner |
| `messages` | all | **Device that sends/receives** | Counterparty |
| `proof_bundles` | `cid`, `captured_at`, `capture_geohash`, `signature_valid`, `uploaded_at` | **Runner** | Customer |
| `proof_bundles` | `verified_at`, `verification_result`, `verification_note` | **Customer** | Runner |
| `wallet_metadata` | all | **Runner device only** | — |
| `payment_events` | all | **Customer** (observes payment) | Runner |
| `strikes` | all | **Admin service** | Customer (mirror) |
| `runner_directory` | all | **Admin service** | Customer, Runner (mirror) |
| `platform_settings` | all | **Admin service** | Customer, Runner (mirror) |
| `disputes` | `id`, `order_id`, `customer_did`, `runner_did`, `reason`, `created_at` | **Customer** (draft) → **Admin** (submitted) | Runner (mirror), Customer |
| `disputes` | `proof_cid`, `proof_key_shared`, `status`, `resolved_at`, `admin_response` | **Admin service** | Customer, Runner |
| `sync_state` | all | **Local device** (bookkeeping) | — |
| `swaps` | all | **Device itself** (both apps) | — |
| `exchange_offers` | all | **App bundle** (cached) | Customer, Runner |
| `swap_events` | all | **Device itself** (both apps) | — |

---

## 3. Read Permission Matrix

| Table | Customer App | Runner App | Admin Service |
|-------|--------------|------------|---------------|
| `identity` | Own row | Own row | — |
| `contacts` | Own rows | Own rows | — |
| `catalog_items` | ✅ | ✅ | — |
| `price_lists` | ✅ (cached) | ✅ (own) | — |
| `runner_prices` | ✅ (cached) | ✅ (own) | — |
| `orders` | ✅ | ✅ | — |
| `order_items` | ✅ | ✅ | — |
| `messages` | Own threads | Own threads | — |
| `proof_bundles` | ✅ | ✅ | — |
| `wallet_metadata` | — | ✅ | — |
| `payment_events` | ✅ | ✅ | — |
| `strikes` | ✅ (own only) | ❌ | ✅ |
| `runner_directory` | ✅ | ✅ | ✅ |
| `platform_settings` | ✅ | ✅ | ✅ |
| `disputes` | Own + against them | Against them only | ✅ |
| `sync_state` | Own | Own | — |
| `swaps` | Own | Own | — |
| `exchange_offers` | ✅ | ✅ | — |
| `swap_events` | Own | Own | — |

---

## 4. Enforcement Rules

### 4.1 Query Layer Enforcement (TypeScript)

```typescript
// packages/db/src/ownership.ts
import { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';

// Writer types — only these can create/update
export type WriterRole = 'customer' | 'runner' | 'admin' | 'local';

// Table ownership map (generated from schema)
export const TABLE_OWNERSHIP: Record<string, WriterRole | 'shared'> = {
  identity: 'shared',
  contacts: 'shared',
  catalog_items: 'shared',
  price_lists: 'runner',
  runner_prices: 'runner',
  orders: 'shared', // per-column
  order_items: 'customer',
  messages: 'shared',
  proof_bundles: 'shared',
  wallet_metadata: 'runner',
  payment_events: 'customer',
  strikes: 'admin',
  runner_directory: 'admin',
  platform_settings: 'admin',
  disputes: 'shared', // customer draft, admin resolution
  sync_state: 'local',
  swaps: 'shared',
  exchange_offers: 'shared',
  swap_events: 'shared',
  payment_events: 'customer',
};

// Column-level ownership for shared tables
export const COLUMN_OWNERSHIP: Record<string, Record<string, WriterRole>> = {
  orders: {
    id: 'customer',
    customer_did: 'customer',
    runner_did: 'customer',
    status: 'runner',
    dispute_state: 'runner', // mirrored from admin
    total_zar: 'customer',
    delivery_fee_zar: 'customer',
    monero_subaddress: 'customer',
    payment_txid: 'customer',
    paid_at: 'customer',
    expires_at: 'customer',
    cancelled_by: 'customer',
    cancel_reason: 'customer',
    delivery_geohash: 'runner',
    proof_cid: 'runner',
    proof_key: 'runner',
    delivered_at: 'runner',
    confirmed_at: 'customer',
    created_at: 'customer',
    updated_at: 'runner',
    purge_after: 'runner',
  },
  proof_bundles: {
    cid: 'runner',
    captured_at: 'runner',
    capture_geohash: 'runner',
    signature_valid: 'runner',
    uploaded_at: 'runner',
    verified_at: 'customer',
    verification_result: 'customer',
    verification_note: 'customer',
    purge_after: 'runner',
  },
  disputes: {
    // Customer writes draft; admin writes resolution
    id: 'customer',
    order_id: 'customer',
    customer_did: 'customer',
    runner_did: 'customer',
    reason: 'customer',
    proof_cid: 'customer',
    proof_key_shared: 'customer',
    status: 'admin',
    created_at: 'customer',
    resolved_at: 'admin',
    admin_response: 'admin',
  },
};

// Runtime enforcement
export function assertCanWrite(
  table: string,
  column: string,
  currentUserRole: WriterRole
): asserts currentUserRole is WriterRole {
  const tableOwner = TABLE_OWNERSHIP[table];
  const columnOwner = COLUMN_OWNERSHIP[table]?.[column];
  
  const effectiveOwner = columnOwner ?? tableOwner;
  
  if (effectiveOwner === 'shared') return; // Per-row logic handles
  if (effectiveOwner === 'local') return;  // Local bookkeeping
  if (effectiveOwner !== currentUserRole) {
    throw new Error(
      `Ownership violation: ${currentUserRole} cannot write ${table}.${column} (owner: ${effectiveOwner})`
    );
  }
}

// Query helpers that enforce ownership
export function customerOrdersQuery(db: Database) {
  return db.get('orders').query(
    Q.where('customer_did', Q.eq(currentUserDID)) // Customer only sees their orders
  );
}

export function runnerOrdersQuery(db: Database) {
  return db.get('orders').query(
    Q.where('runner_did', Q.eq(currentUserDID)) // Runner only sees their orders
  );
}
```

### 4.2 WatermelonDB Model Enforcement

```typescript
// packages/db/src/models/Order.ts
import { Model } from '@nozbe/watermelondb';
import { field, readonly, date, writer } from '@nozbe/watermelondb/decorators';
import { assertCanWrite, WriterRole } from '../ownership';

export class Order extends Model {
  static table = 'orders';
  
  @field('customer_did') customer_did!: string;
  @field('runner_did') runner_did!: string;
  
  // Customer-owned
  @writer((role: WriterRole) => assertCanWrite('orders', 'total_zar', role))
  @field('total_zar') total_zar!: string;
  
  @writer((role: WriterRole) => assertCanWrite('orders', 'monero_subaddress', role))
  @field('monero_subaddress') monero_subaddress?: string;
  
  // Runner-owned
  @writer((role: WriterRole) => assertCanWrite('orders', 'status', role))
  @field('status') status!: string;
  
  @writer((role: WriterRole) => assertCanWrite('orders', 'proof_cid', role))
  @field('proof_cid') proof_cid?: string;
  
  // ... other fields
}
```

### 4.3 Admin Service Enforcement (Rust)

```rust
// services/admin/src/ownership.rs
use sqlx::SqlitePool;

pub async fn enforce_bounded_scope(pool: &SqlitePool) -> Result<(), Error> {
    // See Admin SPEC §4.2 for full implementation
    // Verifies no admin table references orders/messages/proofs
}

pub fn assert_admin_can_write(table: &str, column: &str) -> Result<(), Error> {
    const ALLOWED: &[(&str, &str)] = &[
        ("disputes", "status"),
        ("disputes", "resolved_at"),
        ("disputes", "admin_response"),
        ("disputes", "proof_key"), // only during review
        ("runner_registry", "approved_at"),
        ("runner_registry", "banned_at"),
        ("runner_registry", "ban_reason"),
        ("strikes", "issued_at"),
        ("strikes", "revoked_at"),
        ("strikes", "notes"),
        ("platform_settings", "value"),
        ("platform_settings", "updated_at"),
    ];
    
    if !ALLOWED.iter().any(|(t, c)| *t == table && *c == column) {
        return Err(Error::OwnershipViolation { table, column });
    }
    Ok(())
}
```

---

## 5. Unit Test for Ownership Contract

```typescript
// packages/db/src/__tests__/ownership.test.ts
import { assertCanWrite, TABLE_OWNERSHIP, COLUMN_OWNERSHIP } from '../ownership';

describe('Database Ownership Contract', () => {
  // Customer can write their columns
  test('customer can write order total_zar', () => {
    expect(() => assertCanWrite('orders', 'total_zar', 'customer')).not.toThrow();
  });
  
  test('customer can write order monero_subaddress', () => {
    expect(() => assertCanWrite('orders', 'monero_subaddress', 'customer')).not.toThrow();
  });
  
  // Customer CANNOT write runner columns
  test('customer cannot write order status', () => {
    expect(() => assertCanWrite('orders', 'status', 'customer')).toThrow('Ownership violation');
  });
  
  test('customer cannot write proof_cid', () => {
    expect(() => assertCanWrite('orders', 'proof_cid', 'customer')).toThrow('Ownership violation');
  });
  
  // Runner can write their columns
  test('runner can write order status', () => {
    expect(() => assertCanWrite('orders', 'status', 'runner')).not.toThrow();
  });
  
  test('runner can write proof_cid', () => {
    expect(() => assertCanWrite('orders', 'proof_cid', 'runner')).not.toThrow();
  });
  
  // Runner CANNOT write customer columns
  test('runner cannot write total_zar', () => {
    expect(() => assertCanWrite('orders', 'total_zar', 'runner')).toThrow('Ownership violation');
  });
  
  // Admin can only write moderation tables
  test('admin can write dispute status', () => {
    expect(() => assertCanWrite('disputes', 'status', 'admin')).not.toThrow();
  });
  
  test('admin cannot write orders', () => {
    expect(() => assertCanWrite('orders', 'status', 'admin')).toThrow('Ownership violation');
  });
  
  // All critical tables have ownership defined
  test('all tables in TABLE_OWNERSHIP', () => {
    const criticalTables = [
      'identity', 'contacts', 'catalog_items', 'price_lists', 'runner_prices',
      'orders', 'order_items', 'messages', 'proof_bundles', 'wallet_metadata',
      'payment_events', 'strikes', 'runner_directory', 'platform_settings',
      'disputes', 'sync_state', 'swaps', 'exchange_offers', 'swap_events'
    ];
    
    for (const table of criticalTables) {
      expect(TABLE_OWNERSHIP).toHaveProperty(table);
    }
  });
  
  // All orders columns have ownership defined
  test('all orders columns in COLUMN_OWNERSHIP', () => {
    const orderColumns = [
      'id', 'customer_did', 'runner_did', 'status', 'dispute_state',
      'total_zar', 'delivery_fee_zar', 'monero_subaddress', 'payment_txid',
      'paid_at', 'expires_at', 'cancelled_by', 'cancel_reason',
      'delivery_geohash', 'proof_cid', 'proof_key', 'delivered_at',
      'confirmed_at', 'created_at', 'updated_at', 'purge_after'
    ];
    
    for (const col of orderColumns) {
      expect(COLUMN_OWNERSHIP.orders).toHaveProperty(col);
    }
  });
});
```

---

## 6. Migration Impact

When adding/modifying columns:
1. Update `TABLE_OWNERSHIP` or `COLUMN_OWNERSHIP`
2. Add corresponding test case
3. Run `validate-schema.ts` script (Directive 3.1)
4. Ensure migration is additive-only (no ownership changes to existing data)

---

## 7. Open Questions

- **OQ-OWN-001**: Should `disputes.proof_key_shared` be writable by customer only, or also by admin (to track)? Current: customer writes, admin reads.
- **OQ-OWN-002**: `sync_state` is local-only — should it be in the contract? Current: yes, for completeness.
- **OQ-OWN-003**: Enforcement at database level (triggers) vs application level? Current: application level (TypeScript + Rust) for flexibility.