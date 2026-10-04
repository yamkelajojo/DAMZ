# ADR-0036: Push Notifications: UnifiedPush

**Status**: Accepted

## Context

Need push notifications without Google/Apple dependency.

## Decision

Self-hosted UnifiedPush distributor over Tor. No Google/Apple dependency.

## Consequences

- **Distributor**: Self-hosted on admin VPS (UnifiedPush spec)
- **Apps register** via Tor on first launch (persistent connection)
- **Push payload** = encrypted Signal message (E2EE)
- **Delivery**: App receives push → wakes → fetches full message via relay → shows local notification

**Why not FCM/APNs**: Requires Google/Apple servers, violates anonymity. UnifiedPush is open, self-hosted, works over Tor.

**Battery**: Efficient — app only wakes when actual message arrives.

**Fallback**: If UnifiedPush unavailable, app falls back to periodic relay poll (30s) when backgrounded.