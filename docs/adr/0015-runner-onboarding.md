# ADR-0015: Runner Onboarding: Invite-Only Pre-Creation via Admin CLI

**Status**: Accepted

## Context

SPEC implied a dashboard approval flow. Grilling favored the simplest model: no dashboard UI, no application API, no IPNS. Admin controls the registry directly.

## Decision

Admin pre-creates `runner_registry` rows (DID + onion + `approved_at=null`) via CLI/script. Runner claims on first app launch.

## Consequences

- **Admin CLI**: `cargo run --bin admin-cli -- runner add --did did:key:z6Mk... --onion abc123.onion`
- **Runner app flow**: On first launch, generates `did:key` + onion (via `mkp224o` or Tor daemon). Queries admin service `/runners/me` (authenticated by DID signature). If registry entry exists with matching DID+onion and `approved_at=null`, prompts "Claim this runner profile?" → sets local `identity.is_available=1`.
- **No dashboard needed** for v1. Admin manages runners via CLI + SQLite direct access.
- **Revocation**: Admin sets `banned_at` + `ban_reason` via CLI. Runner's app syncs `runner_directory` mirror, sees ban, sets `is_available=0` locally.
- **Scaling**: If runner count grows >50, build minimal dashboard. For v1 (single-digit runners), CLI is sufficient.