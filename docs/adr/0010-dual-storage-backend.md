# ADR-0010: IPFS Storage: Meshkit S3 Primary + Helia Optional (Dual Backend v1)

**Status**: Accepted

## Context

SPEC recommended Meshkit v1 → Helia v2 migration. The grilling session concluded that offering both in parallel lets privacy-maximalist users (GrapheneOS, CalyxOS) use true IPFS while the majority gets the simpler S3 path. It also de-risks the Helia migration by testing it in production.

## Decision

Ship both storage backends in v1: Meshkit S3 (MinIO behind Tor) as default, Helia (full IPFS in RN) as opt-in behind a feature flag.

## Consequences

- Storage abstraction layer in `packages/core/storage` with `StorageBackend` trait/interface.
- `MeshkitBackend` (default): `@ipfs-meshkit/meshkit` S3 client, AES-256-GCM encryption, MinIO .onion endpoint.
- `HeliaBackend` (opt-in): `helia` + custom React Native storage adapter (AsyncStorage/WatermelonDB), libp2p over Tor via `arti` or system Tor.
- Feature flag `useHelia` in app settings; persists choice across launches.
- Both backends produce CIDs compatible with the same `proof_bundles` table.
- Helia path requires more permissions (network, background) and battery; document clearly.
- If Helia proves stable, promote to default in v2; Meshkit becomes fallback.