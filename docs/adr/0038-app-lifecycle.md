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
| Biometric | Wallet seed/spend-key setup (Customer and Runner) / first secure action | Biometric-only native access; native recovery-phrase fallback; optional view key may use PIN-derived HKDF per ADR-0028 |
| Network | Immediate (Tor needs it) | N/A — required |

**Biometric**: Seed and spend-key access is biometric-only in both apps with no PIN fallback. An optional private view key may use PIN-derived HKDF protection inside native `SecureMemory` only (ADR-0028). Recovery phrase is the fallback for seed/spend-key access and is entered through native UI.