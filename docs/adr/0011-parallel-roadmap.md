# ADR-0011: Roadmap: Parallelize Independent Phases, Vertical Integration Last

**Status**: Accepted

## Context

Original SPEC had strictly sequential phases. Grilling revealed Tor/Signal, Payment/Location/Photo, and Storage/Identity are independent and can be developed by separate workstreams.

## Decision

Reorder the 10 SPEC phases into three parallel tracks + integration:

- **Track A (Transport + Messaging)**: P1 Tor transport + P2 Signal Protocol (can share the Tor daemon instance).
- **Track B (Device Capabilities)**: P3 Monero payment (mock) + P4 ZK location proof + P5 Photo attestation (all independent device-native features).
- **Track C (Storage + Identity)**: P6 IPFS storage (Meshkit + Helia flag) + P7 DID identity (`did:key`).
- **Track D (Infrastructure)**: P9 Relay + MoneroPay/AcceptXMR gateway + IPFS pinner (server-side, can start after Track A works).
- **Integration**: P8 (wire all tracks into order lifecycle) → P10 Mainnet deploy.

## Consequences

- Track A is the true critical path — nothing works without Tor + Signal.
- Track B and C can be built by different engineers in parallel.
- Track D (server infra) can start once Track A has a working Tor daemon.
- Integration (P8) is the synchronization point — budget 40% of timeline for it.
- Mock adapters for each track allow parallel UI development.