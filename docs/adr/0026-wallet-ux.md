# ADR-0026: Runner Wallet UX

**Status**: Accepted; phrase length and optional view-key unlock clause partially superseded by ADR-0028

## Context

Monero wallet holds real funds. Grilling session prioritized maximum security with practical UX.

## Decision

Runner wallet uses 24-word seed, biometric-only unlock, duress PIN, auto subaddress labels, fee preview. The original 24-word phrase-length clause and no-PIN rule for an optional private view key are superseded by ADR-0028; the remaining UX decisions stay accepted.

## Supersession — ADR-0028

ADR-0028 replaces the 24-word phrase-length decision below with the complete native Monero
25-word mnemonic for backup and recovery. Biometric-only access with no PIN fallback remains
for the seed and spend keys. A persisted private view key may use PIN-derived HKDF protection,
but only inside native `SecureMemory`; this is a narrow exception to the no-PIN rule. ADR-0028
also extends native-only wallet-secret handling to the Customer app; this ADR's duress PIN,
subaddress labels, and fee-preview decisions continue to describe the Runner wallet.

## Consequences

- **Seed (original decision)**: 24 words (256-bit entropy); phrase length superseded by ADR-0028, which requires the complete 25-word Monero mnemonic.
- **Unlock**: Seed/spend-key access is biometric-only (FaceID/TouchID/Fingerprint), no PIN fallback. Optional private view key may use native PIN-derived HKDF protection (ADR-0028).
- **Duress**: Fake PIN shows nearly-empty wallet (small balance) to protect main funds under coercion
- **Subaddress labels**: Auto-generated "Order #DMZ-XXX" for order tracking
- **Fee preview**: Network fee shown before transaction confirmation
- **Recovery**: Seed phrase restore only. No cloud backup. Biometric failure → native recovery phrase entry.
