# ADR-0019: ZK Location Proof: Port Zakura Common Optimizations to `@ajna-inc/poe-proofs`

**Status**: Accepted

## Context

SPEC specified `@ajna-inc/poe-proofs` as-is. Grilling revealed the user wants the performance headroom for low-end Android devices; 0.26s proof generation may be too slow on older hardware.

## Decision

Fork `@ajna-inc/poe-proofs` and port Zakura Common's floating-point SNARK optimizations (Sinsemilla hash, parallel witness generation) for 14x faster mobile proof generation.

## Consequences

- **Fork strategy**: Fork `@ajna-inc/poe-proofs` to `damz/poe-proofs-zakura`. Replace the SNARK backend with Zakura's optimized circuits.
- **Zakura dependencies**: Requires `arkworks` (Rust) for circuit definition, compiled to WASM via `wasm-bindgen`. Or port the optimizations to the existing bellman/groth16 stack in `poe-proofs`.
- **Risk**: Cryptography modifications require expert review. Budget 2-3 weeks for port + audit.
- **Fallback**: If port delays v1, ship `@ajna-inc/poe-proofs` as-is with coarse geohash fallback (no ZK) for devices where proof generation >5s.
- **Verification**: Keep `snarkjs` verification in Node.js (admin service, customer app) — only prover changes.
- **Upstream**: Contribute optimizations back to `@ajna-inc/poe-proofs` if successful.

### Later backend extension — ADR-0030

ADR-0030 adds Mopro/GPU as an optional, additional on-device prover backend. It does not
replace the Zakura-optimized CPU path, the unmodified `@ajna-inc/poe-proofs` CPU interim
fallback, the shared proof-verification contract, or ADR-0027's coarse-geohash last resort.
Mopro remains disabled until the exact DAMZ circuit, verification-key compatibility, and
mobile performance/security gates pass.
