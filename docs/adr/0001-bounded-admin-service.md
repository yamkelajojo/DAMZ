# ADR-0001: Bounded Admin Service as the Single Central Authority

**Status**: Accepted

## Context

DAMZ is local-first: order and chat data never leave the two devices involved. The Admin service was originally scoped to runner registry, bans, strikes, disputes, and platform settings. Its only later narrow extension is the managed-Android app-data wipe command metadata recorded in ADR-0029. It must never store order contents, chat messages, or delivery proofs.

This is a deliberate exception to the "no central store of user data" principle. Without it, there is no way for an Admin to ban a malicious runner or record a strike that a device cannot simply edit away.

## Decision

Deploy a single bounded Admin service (Tor-hidden) that holds moderation state and the narrowly scoped `wipe_pending` control metadata later accepted in ADR-0029. It holds zero rows of order, message, or proof data and is not a central user database.

## Consequences

- **Considered options**: Fully serverless (community blocklist signed by the Admin); or deferring the service to v2. Both were rejected because moderation has to be authoritative somewhere, and SIGINT/deploy cost of the minimal service is low.
- The Admin service becomes the single source of truth for runner approval, bans, strikes, disputes, and platform settings.
- Devices mirror this state read-only via REST + SSE sync (ADR-0016).

## Narrow scope extension — ADR-0029

ADR-0029 partially supersedes the original “moderation state only” scope: the Admin service
may also store the minimal `wipe_pending` command metadata needed for best-effort DAMZ
app-data erasure on verified managed Android installations. This does not authorize a
central user database or storage of order, message, or proof content. The six-table Admin
schema remains separate from the 19 client-side tables; full-device reset, iOS, and
unmanaged Android remain out of scope.