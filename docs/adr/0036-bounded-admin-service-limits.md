# ADR-0036: Bounded Admin Service and the Limits of "No Central Server"

**Status**: Accepted

## Context

The original specification and testing documents state "No Central Database Server" as an absolute principle. However, ADR-0001 introduced a bounded Admin service that holds moderation state (runner registry, bans, strikes, disputes, platform settings). This creates a contradiction in the documentation.

## Decision

Replace every instance of the absolute phrase "No Central Database Server" with the precise constraint:

> "No central store of order content, chat content, proof content, or user identity. The Admin service is authoritative only for moderation state and holds zero rows of order, message, or proof data."

## Consequences

- `DB_ARC_and_TEST_PLANNING.md` §1.1 principle #2 is updated
- `SPEC.md` threat model assumptions are updated
- All future documentation uses the precise language
- The bounded Admin service (ADR-0001) is explicitly acknowledged as the single exception to "no central server," with its scope strictly limited to moderation state

**Rationale**: Absolute statements that are technically false undermine credibility and create confusion during implementation. The precise constraint captures the actual security property: user data (orders, chats, proofs, identity) never hits a central server. Only moderation metadata does.