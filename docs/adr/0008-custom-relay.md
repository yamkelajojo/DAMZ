# Discardable relay: custom minimal Rust implementation

**Status**: accepted

Build a ~200-line Rust relay (Axum + Tokio + Arti) that accepts encrypted blobs over Tor HTTP, stores in memory with TTL, forwards on GET. No Cwtch/SimpleX protocol baggage.

**Context**: SPEC sketched a Cwtch-inspired relay but didn't commit to implementation. The grilling session concluded that a custom minimal relay matches DAMZ's simpler threat model (no group chat, no metadata resistance beyond what Tor + Signal already provide) and avoids auditing large third-party codebases.

**Consequences**:
- Relay protocol: `PUT /blob/{recipient_onion_hash}` (store), `GET /blob/{blob_id}` (retrieve + delete).
- In-memory only, no persistence, no logs.
- Runs as Tor hidden service (via `arti` or system Tor).
- Multiple community relays can run the same binary; clients discover via IPNS.
- No dependency on Cwtch or SimpleX release cycles.
- If relay is compromised, it only sees encrypted blobs and recipient onion hashes (hash of Tor public key) — no identities, no plaintext.