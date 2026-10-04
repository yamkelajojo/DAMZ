# ADR-0038: App Lifecycle & Permissions

**Status**: Accepted

## Context

Need graceful fallbacks for all permission denied scenarios.

## Decision

Graceful fallbacks for all permission denied scenarios.

## Consequences

**App States**:
- Cold start: Init Tor → Connect relay → Sync mirrors → Load UI (<3s target)
- Warm start: Resume Tor → Check pending messages → Update UI
- Background: Tor foreground service keeps running → Relay polls → UnifiedPush wakes app
- Foreground: Immediate message fetch → Mark read → Sync
- Termination: Tor stops (unless orders active) → Save state

**Permissions** (requested at appropriate time):

| Permission | When Requested | Denied Fallback |
|------------|----------------|-----------------|
| Camera | Delivery capture (Runner) / QR scan (Customer) | Runner: cannot fulfill orders. Customer: manual address entry |
| Location | Delivery (Runner ZK) / Discover runners (Customer) | Manual address + geocoder |
| Notifications | After onboarding | In-app badge only |
| Biometric | Wallet setup (Runner) / First secure action | Biometric-only (recovery phrase fallback) |
| Network | Immediate (Tor needs it) | N/A — required |

**Biometric**: Biometric-only unlock (no PIN fallback). Recovery phrase is the only fallback.