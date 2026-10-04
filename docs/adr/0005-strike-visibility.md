# Runners never see Customer strikes

**Status**: accepted

Strike data against Customers is held only on the Admin service and mirrored read-only onto
the **Customer's own device** — never onto a Runner's. A Runner learns nothing about a
Customer's standing, before or after accepting an order.

**Context**: a strike count is useful to a Runner deciding whether to accept work, but the
lookup is not free. Asking the admin service "what is the standing of DID X?" tells the
server, for every request, which Runner is about to serve which Customer. That is exactly
the order-adjacent metadata ADR-0001 exists to keep off the server, reconstructed one query
at a time. Runners are also offline for long stretches; they would be relying on a cached
answer anyway.

**Considered options**: a coarse "this customer has open strikes" flag shown before
accepting (useful for refusal, leaks the runner→customer link); the full strike history
(informative, and effectively a reputation system bolted onto an anonymous design); a
privacy-preserving membership proof that a Customer is in good standing without revealing
which Customer (correct, but a v2-scale piece of cryptography).

**Consequences**: abuse is handled reactively — a Runner who is wronged contacts the Admin,
who issues a strike that the Customer's own device mirrors. A Customer can rotate to a new
`did:key` to escape strikes, exactly as a Runner can escape a ban; identity rotation is a
property of the anonymous design, not a defect to patch here. The Runner app ships without
the `strikes` table at all. The three-strikes rule remains a deterrent against casual abuse
rather than an enforceable identity ban.
