# Mock payment provider: Configurable scenarios for all payment states

**Status**: accepted

`MockPaymentProvider` implements `PaymentProvider` interface with scenario prop: `'success' | 'timeout' | 'partial' | 'double'`. Exercises all `payment_events` kinds.

**Context**: v1 uses mock payment (ADR-0009 AcceptXMR is real gateway but not wired in v1 app). Grilling chose configurable mock to test all payment UI states.

**Consequences**:
- **Interface**:
  ```typescript
  interface PaymentProvider {
    requestPayment(order: Order): Promise<{ subaddress: string; amountXmr: string; expiresAt: number }>;
    checkStatus(orderId: string): Promise<'pending' | 'confirmed' | 'expired'>;
    onPaymentUpdate: (orderId: string, status: 'confirmed' | 'expired') => void;
  }
  ```
- **Scenarios**:
  - `'success'`: Returns subaddress, `checkStatus` → `'confirmed'` after 2s.
  - `'timeout'`: Returns subaddress, `checkStatus` → `'pending'` until `expiresAt`, then `'expired'`.
  - `'partial'`: `checkStatus` → `'pending'` with `partialAmount`, then `'confirmed'` on full.
  - `'double'`: `checkStatus` → `'confirmed'` twice (idempotency test).
- **Usage**: `MockPaymentProvider` injected via React Context. Cypress/Maestro tests select scenario via deep link or settings.
- **Real gateway**: `AcceptXmrPaymentProvider` implements same interface. Swap in `App.tsx` via feature flag.