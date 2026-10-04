# Admin service: Rust + Axum over Node.js Fastify

**Status**: accepted

The single Tor-hidden admin service (registry, bans, strikes, disputes, settings) is implemented in Rust with Axum, not Node.js Fastify.

**Context**: The SPEC originally specified Fastify for TypeScript consistency with the mobile apps. The grilling session prioritized memory safety, smaller attack surface, and single-binary deployment for a security-critical service that holds moderation authority.

**Consequences**:
- No shared TypeScript types with mobile apps — must maintain OpenAPI spec or Protobuf contract separately.
- Uses `sqlx` with `sqlcipher` feature for compile-time checked SQL.
- Tor hidden service via `arti-client` (Rust Tor implementation) or `tor-rtcompat` with system Tor.
- Single static binary deployable to any Linux VPS behind Tor.
- Steeper initial development cost; lower long-term maintenance risk.
- Admin service is tiny (~10 endpoints, 5 tables) — the Rust learning curve is bounded.