# ADR-0002: Identity is `did:key`, Not a Ledger-Based DID

**Status**: Accepted

## Context

`SPEC.md` names `did:key`/`did:ethr` but selects `@credebl/ssi-mobile`, which is a Hyperledger Indy/Aries stack and issues `did:indy` against a ledger. Those are incompatible choices; the ledger dependency is not worth it for v1.

## Decision

Use self-certifying `did:key` identifiers generated on device. No ledger or network call is required to create or resolve them, which matches an offline-first application running over Tor.

## Consequences

- We do not get verifiable credentials for runner approval out of the box.
- If credential-based runner approval is needed later, revisit a verifiable-credential layer independently of the base identity.
- Implementation via `@did-tools/key` (ADR-0018).