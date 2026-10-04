# ADR-0014: Converter App: Full UnstoppableSwap (BTC↔XMR Atomic Swaps) in v1

**Status**: Accepted

## Context

SPEC scoped converter as rate display + links. Grilling revealed the user wants the atomic swap capability in v1 to serve BTC holders directly, avoiding centralized P2P platforms.

## Decision

The converter app includes full UnstoppableSwap integration for BTC↔XMR atomic swaps using the COMIT protocol, not just rate display.

## Consequences

- **COMIT protocol**: Requires Bitcoin HTLC (Hash Time-Locked Contract) + Monero HTLC (using Monero's native atomic swap support via adaptor signatures).
- **Dependencies**: `bitcoinjs-lib` for Bitcoin TX construction, `react-native-mymonero-core` for Monero adaptor signatures, `comit-network` SDK if available (or custom implementation).
- **Architecture**: Converter app holds no funds. User initiates swap → app constructs Bitcoin HTLC + Monero HTLC → user funds Bitcoin HTLC → swap executes atomically or times out → user claims XMR or refunds BTC.
- **Risk**: Significant cryptographic complexity. COMIT is less audited than Lightning or on-chain swaps. Test extensively on testnet.
- **Alternative path**: If COMIT proves too risky for v1 timeline, fall back to rate display + Haveno deep links (ADR-0014 fallback), but aim for full swap.
- **Permissions**: Needs Bitcoin network access (clearnet or Tor), Monero stagenet/mainnet access.