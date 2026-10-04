# ADR-0001: Bounded Admin Service as the Single Central Authority

**Status**: Accepted

## Context

DAMZ is local-first: order and chat data never leave the two devices involved. We nevertheless run one small Tor-hidden service that is authoritative for **runner registry, bans, strikes, disputes, and platform settings** — and for nothing else. It must never store order contents, chat messages, or delivery proofs.

This is a deliberate exception to the "no central store of user data" principle. Without it, there is no way for an Admin to ban a malicious runner or record a strike that a device cannot simply edit away.

## Decision

Deploy a single bounded Admin service (Tor-hidden) that holds only moderation state. It holds zero rows of order, message, or proof data.

## Consequences

- **Considered options**: Fully serverless (community blocklist signed by the Admin); or deferring the service to v2. Both were rejected because moderation has to be authoritative somewhere, and SIGINT/deploy cost of the minimal service is low.
- The Admin service becomes the single source of truth for runner approval, bans, strikes, disputes, and platform settings.
- Devices mirror this state read-only via REST + SSE sync (ADR-0016).