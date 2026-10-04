# ADR-0007: Admin Service: Rust + Axum Over Node.js Fastify

**Status**: Accepted

## Context

The SPEC originally specified Fastify for TypeScript consistency with the mobile apps. The grilling session prioritized memory safety, smaller attack surface, and single-binary deployment for a security-critical service that holds moderation authority.

## Decision

The single Tor-hidden admin service (registry, bans, strikes, disputes, settings) is implemented in Rust with Axum, not Node.js Fastify.

## Consequences

- No shared TypeScript types with mobile apps — must maintain OpenAPI spec or Protobuf contract separately.
- Uses `sqlx` with `sqlcipher` feature for compile-time checked SQL.
- Tor hidden service via `arti-client` (Rust Tor implementation) or `tor-rtcompat` with system Tor.
- Single static binary deployable to any Linux VPS behind Tor.
- Steeper initial development cost; lower long-term maintenance risk.
- Admin service remains bounded; ADR-0029 adds the sixth Admin-only table, `wipe_pending`, for managed-Android app-data wipe metadata. It does not change the Rust/Axum implementation choice or the 19-table client schema.