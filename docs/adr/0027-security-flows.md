# ADR-0027: Security Flows: Migration & Fallbacks

**Status**: Accepted

## Context

Multiple components can fail in production. Need consistent fallback strategy.

## Decision

Standardized fallback behavior for all critical security components.

## Consequences

| Component | Primary | Fallback |
|-----------|---------|----------|
| Identity migration | Seed phrase restore on new device | — |
| Biometric failure (seed/spend keys) | Native recovery phrase entry | No PIN fallback; optional private view-key PIN-derived HKDF remains the native-only exception in ADR-0028 |
| Tor connection | Exponential backoff (1s, 2s, 4s... max 60s) + "Tor connecting..." indicator | Offline mode: cached data readable |
| Signal session corruption | Automatic re-keying (Signal Protocol) | Manual "reset chat" if persistent |
| ZK proof failure | Retry with lower precision | Coarse geohash check only (no ZK) |

**Rationale**: Seed/spend-key recovery uses the native 25-word phrase; no PIN fallback is allowed for those keys. The optional private view-key PIN-derived HKDF path is the narrow native-only exception in ADR-0028. Tor resilience built-in. Signal handles re-keying. ZK graceful degradation.