# ADR-0006: Signal Protocol: `react-native-libsignal-client` Over `expo-libsignal`

**Status**: Accepted

## Context

The SPEC originally specified `expo-libsignal` for its Expo integration and built-in SQLCipher store. The grilling session revealed that cryptographic maturity and avoiding Expo plugin lock-in outweigh the DX convenience. `react-native-libsignal-client` wraps the same Rust core used by Signal, WhatsApp, and Wire — it is the reference implementation.

## Decision

Use `react-native-libsignal-client` (wraps the official libsignal Rust core via native bindings) instead of the Expo-native `expo-libsignal`.

## Consequences

- Must implement a SQLCipher-backed `SignalProtocolStore` ourselves (≈200 lines wrapping `expo-sqlite`).
- No Expo plugin — manual `npx pod-install` and native module linking required.
- Larger binary size from Rust toolchain, but auditable cryptography.
- Sealed Sender and Sender Keys are available but need manual wiring.
- Kyber post-quantum KEM included in the libsignal core we wrap.