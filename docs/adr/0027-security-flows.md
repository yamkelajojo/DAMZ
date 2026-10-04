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
| Biometric failure | Recovery phrase entry | No PIN fallback |
| Tor connection | Exponential backoff (1s, 2s, 4s... max 60s) + "Tor connecting..." indicator | Offline mode: cached data readable |
| Signal session corruption | Automatic re-keying (Signal Protocol) | Manual "reset chat" if persistent |
| ZK proof failure | Retry with lower precision | Coarse geohash check only (no ZK) |

**Rationale**: Single source of truth (seed phrase) for identity. No PIN = no weak link. Tor resilience built-in. Signal handles re-keying. ZK graceful degradation.