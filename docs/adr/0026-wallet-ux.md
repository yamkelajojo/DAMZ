# ADR-0026: Runner Wallet UX

**Status**: Accepted

## Context

Monero wallet holds real funds. Grilling session prioritized maximum security with practical UX.

## Decision

Runner wallet uses 24-word seed, biometric-only unlock, duress PIN, auto subaddress labels, fee preview.

## Consequences

- **Seed**: 24 words (256-bit entropy) — standard Monero, more secure than 12-word
- **Unlock**: Biometric-only (FaceID/TouchID/Fingerprint), no PIN fallback. If sensor fails, recovery phrase entry required.
- **Duress**: Fake PIN shows nearly-empty wallet (small balance) to protect main funds under coercion
- **Subaddress labels**: Auto-generated "Order #DMZ-XXX" for order tracking
- **Fee preview**: Network fee shown before transaction confirmation
- **Recovery**: Seed phrase restore only. No cloud backup. Biometric failure → recovery phrase entry.