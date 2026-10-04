# Bounded admin service as the single central authority

**Status**: accepted

DAMZ is local-first: order and chat data never leave the two devices involved. We
nevertheless run one small Tor-hidden service that is authoritative for **runner
registry, bans, strikes, disputes, and platform settings** — and for nothing else. It
must never store order contents, chat messages, or delivery proofs.

This is a deliberate exception to the "no central database server" principle in
`DB_ARC_and_TEST_PLANNING.md`. Without it, there is no way for an Admin to ban a
malicious runner or record a strike that a device cannot simply edit away.

**Considered options**: fully serverless (community blocklist signed by the Admin);
or deferring the service to v2. Both were rejected because moderation has to be
authoritative somewhere, and SIGINT/deploy cost of the minimal service is low.
