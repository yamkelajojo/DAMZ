# ADR-0030: Mopro GPU Backend for On-Device ZK Proofs

**Status**: Accepted (architecture decision; implementation deferred)
**Date**: 2026-10-04
**Owner**: Admin/Developer

## Context

ADR-0019 selects the Zakura-optimized CPU prover path for DAMZ's floating-point location
proofs, with the existing `@ajna-inc/poe-proofs` CPU implementation as the fallback if the
Zakura port is delayed. ADR-0027 specifies lower-precision retries and a coarse-geohash
fallback when ZK proving fails or exceeds the five-second gate.

The user selected Mopro/mobile GPU proving as an **additional backend**, not a replacement
for the Zakura/CPU path. Mopro's current documentation describes modular native adapters,
mobile bindings, and GPU acceleration for operations such as MSM; it also recommends
benchmarking the application's own circuit because results vary by circuit. It has not yet
been established that Mopro's available proving adapters can run DAMZ's exact location
circuit or produce proofs accepted by the existing verifier.

## Decision

1. **Add, do not replace.** Mopro with a compatible on-device GPU prover may be enabled as
   an additional backend behind a capability check and feature gate. The Zakura-optimized
   CPU prover remains the supported fallback. If that port is not ready, retain the
   unmodified `@ajna-inc/poe-proofs` CPU path as the interim prover. Mopro is not a reason
   to remove either CPU path.
2. **Use one proof contract.** Every backend must prove the same DAMZ location statement
   with the same public-input schema, circuit semantics, cryptographic parameters, and
   verification key. GPU output must pass the existing proof verifier; no new trust setup,
   weaker statement, or backend-specific acceptance rule is introduced by this ADR.
3. **Keep proving local.** Mopro/GPU is an on-device backend only. Coordinates, witnesses,
   proving keys, and proofs are not sent to a GPU service, Mopro service, or other remote
   accelerator. No network fallback or clearnet path is added.
4. **Selection and fallback order**:
   - When the Mopro backend is explicitly enabled and the device/circuit combination has
     passed the Phase 6 compatibility and parity gate, the app may attempt Mopro/GPU.
   - If it is unavailable, unsupported, over its resource/time budget, or returns an
     error/invalid proof, retry using the Zakura-optimized CPU prover at the requested
     precision. If the Zakura port is not available, use the unmodified
     `@ajna-inc/poe-proofs` CPU implementation.
   - If CPU proving or verification fails, retain ADR-0027's lower-precision CPU retry.
     If CPU proving still fails or exceeds the five-second gate, use the existing
     coarse-geohash fallback (no ZK) and clearly mark that no ZK proof was produced.
   - An invalid GPU proof is never accepted; fallback must generate a fresh CPU proof and
     pass the same verifier.
5. **Guard sensitive intermediate data.** Native/GPU buffers must be released or cleared
   using supported platform mechanisms, and proof inputs/witnesses must never be logged or
   persisted as plaintext. If the implementation cannot keep all proving work local or
   meet the approved privacy and buffer-lifecycle gates, the GPU backend stays disabled and
   the CPU path remains available.
6. **No dependency is installed or pinned by this ADR.** Mopro is a candidate backend whose
   exact adapter, version, and React Native integration are selected only after the
   compatibility and test gates below pass.

## Alternatives Considered

- **Replace Zakura CPU with Mopro/GPU-only proving** — rejected by the user's additive-backend
  choice and because not all devices expose a compatible GPU prover.
- **Use GPU output without the existing verifier/circuit contract** — rejected: all
  backends must prove and verify the same statement; accelerator availability cannot change
  security semantics.
- **Use a remote proving service when local GPU support is unavailable** — rejected: it
  would disclose location witnesses and change DAMZ's local-only proof boundary.
- **Remove CPU fallback after GPU support ships** — rejected: CPU remains required for
  unsupported devices, driver failures, resource limits, and validated recovery.

## Consequences

- ADR-0019 remains authoritative for the Zakura CPU optimization. This ADR adds Mopro/GPU
  without replacing it; the original CPU and geohash fallbacks remain.
- Phase 6 must test proof parity across Mopro/GPU and CPU backends, verify both outputs
  through the same customer/Admin verifier, and measure end-to-end time, memory, and thermal
  behavior on supported Android and iOS devices before enabling the GPU feature.
- No client database table, proof-bundle field, order schema, or Admin authority changes.
  No runtime code, tests, installations, or builds are part of this documentation decision.

## Open Questions

- **OQ-ZK-PROVER-001**: Confirm that a Mopro adapter can support DAMZ's exact floating-point
  location circuit, public inputs, proving parameters, and existing verification key on
  supported mobile targets. **Owner**: Admin/Developer. **Target resolution**: before the
  Phase 6 backend compatibility gate; if incompatible, keep Mopro disabled and use the CPU
  path.
- **OQ-ZK-PROVER-002**: Measure GPU/CPU proof parity, end-to-end performance, memory,
  thermal behavior, failure recovery, and intermediate-buffer handling on the supported
  Android/iOS device matrix. **Owner**: Admin/Developer. **Target resolution**: Phase 6
  before enabling Mopro/GPU for production builds.

## References

- Mopro mobile prover toolkit, adapters, native bindings, and GPU acceleration:
  https://zkmopro.org/docs/intro/
- Mopro circuit-specific performance benchmarks and recommendation to benchmark custom
  circuits: https://zkmopro.org/docs/performance/
- ADR-0019, Zakura CPU prover optimization; ADR-0027, ZK fallback behavior.
