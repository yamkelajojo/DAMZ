# ADR-0018: `did:key` Implementation: `@did-tools/key`

**Status**: Accepted

## Context

ADR-0002 chose `did:key` over ledger-based DIDs. SPEC originally used `@credebl/ssi-mobile` (Indy/Aries). Grilling selected the lightweight TypeScript library.

## Decision

Use `@did-tools/key` (TypeScript) for `did:key` generation, resolution, and verification. No `didkit`, no manual multicodec encoding.

## Consequences

- **Install**: `bun add @did-tools/key`
- **API**:
  ```typescript
  import { DidKey } from '@did-tools/key';
  const { did, privateKey, publicKey } = await DidKey.generate({ algorithm: 'Ed25519' });
  // did = "did:key:z6Mk...", privateKey = Uint8Array, publicKey = Uint8Array
  ```
- **Storage**: Private key → `expo-secure-store` (biometric-gated). DID string → `identity.did` in WatermelonDB.
- **Verification**: `DidKey.verify(signature, data, did)` for DID-signed price lists (ADR-0004).
- **No DIDComm**: v1 does not need DIDComm. If needed later, add `@did-tools/didcomm` or `didkit`.
- **Bundle size**: ~5kb gzipped. No native modules. Works in Hermes/JSI.