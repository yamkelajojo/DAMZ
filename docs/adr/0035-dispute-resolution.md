# ADR-0035: Dispute Resolution Flow

**Status**: Accepted

## Context

Need a complete asymmetric dispute flow where Customer raises, Admin judges with Customer's evidence only.

## Decision

Complete asymmetric dispute flow: Customer raises, Admin judges with Customer's evidence only.

## Consequences

**Customer Side**:
1. Order delivered but issue (non_delivery, wrong_item, other)
2. Tap "Raise Dispute" → select reason → optional: attach proof (photo/chat)
3. Dispute created locally (status: draft) → sync to admin when Tor available
4. Admin reviews → requests proof key if needed
5. Customer shares proof key → Admin decrypts proof bundle
6. Admin resolves → Customer sees result (resolved/dismissed)

**Runner Side**:
1. Notification: "Dispute opened against order #DMZ-XXX"
2. View dispute details (reason, customer's evidence)
3. Cannot see customer's strike count (ADR-0005)
4. Admin may contact runner out-of-band

**Admin Side** (CLI):
1. List open disputes
2. View: order info, customer evidence, runner info
3. Request proof key from customer (if not shared)
4. Decrypt delivery-evidence bundle → verify photo and the location result actually present; treat coarse-geohash fallback as explicitly non-ZK (ADRs 0027, 0030)
5. Rule: resolved (customer right) / dismissed (runner right)

**Rules**:
- Refund = runner sends new Monero payment (no chargebacks)
- Runner strikes: 3 = ban (admin issues via CLI)
- Timeout: 14 days auto-dismiss
- Asymmetric: Runner cannot add evidence (customer-initiated only)