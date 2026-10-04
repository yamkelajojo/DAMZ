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
| ZK proof generation | Optional compatible Mopro/GPU attempt (ADR-0030) | Zakura-optimized CPU at the requested precision (or unmodified `@ajna-inc/poe-proofs` CPU if Zakura is unavailable); if CPU proving/verification fails, retry at lower precision; coarse geohash only (no ZK) if the CPU retry fails or exceeds five seconds |

**Rationale**: Seed/spend-key recovery uses the native 25-word phrase; no PIN fallback is allowed for those keys. The optional private view-key PIN-derived HKDF path is the narrow native-only exception in ADR-0028. Tor resilience is built in, and Signal handles re-keying. For ZK, Mopro/GPU is optional only after compatibility validation; Zakura/CPU remains the fallback, with coarse geohash as the final non-ZK degradation.
