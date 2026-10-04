# ADR-0041: Bounded Admin Service and the Limits of "No Central Server"

**Status**: Accepted

## Context

The original specification and testing documents state "No Central Database Server" as an absolute principle. ADR-0001 introduced a bounded Admin service for moderation state (runner registry, bans, strikes, disputes, platform settings), and ADR-0029 later added the narrowly scoped `wipe_pending` command metadata for managed-Android app-data erasure. This creates a documentation boundary that must be stated precisely without implying a central user database.

## Decision

Replace every instance of the absolute phrase "No Central Database Server" with the precise constraint:

> "No central user profile/account database or central store of order content, chat content, or proof content. The Admin service stores bounded moderation state and, under ADR-0029, only the minimal pseudonymous target-DID and command metadata required for managed-Android DAMZ app-data wipes. It holds zero rows of order, message, or proof data. The target DID is not a device serial, advertising ID, profile, or personal identity record."

## Consequences

- `DB_ARC_and_TEST_PLANNING.md` §1.1 principle #2 is updated
- `SPEC.md` threat model assumptions are updated
- All future documentation uses the precise language
- The bounded Admin service (ADR-0001) is explicitly acknowledged as the single exception to "no central server," with its scope limited to moderation plus the narrow wipe-command metadata allowed by ADR-0029; no general user database is approved
- ADR-0029 partially supersedes ADR-0001's original moderation-only wording while preserving the zero-order/message/proof boundary and the separation from the 19-table client schema

**Rationale**: Absolute statements that are technically false undermine credibility and create confusion during implementation. The precise constraint captures the actual security property: order/chat/proof content and general user profiles never hit a central server. The Admin holds only bounded moderation metadata and ADR-0029's narrowly necessary app-wipe command metadata.