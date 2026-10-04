# ADR-0016: Admin Service API: REST + SSE Over Tor

**Status**: Accepted

## Context

Mobile apps maintain read-only mirrors (`strikes`, `settings`, `directory`, `disputes`) with `sync_state` cursors. Grilling chose REST + SSE for simplicity and debuggability over custom binary protocols.

## Decision

Admin service exposes REST endpoints for sync + SSE stream for push updates. All over Tor hidden service.

## Consequences

- **Endpoints**:
  - `GET /sync/strikes?cursor=<opaque>` → `{items: Strike[], cursor}`
  - `GET /sync/settings?cursor=<opaque>` → `{items: Setting[], cursor}`
  - `GET /sync/directory?cursor=<opaque>` → `{items: RunnerEntry[], cursor}`
  - `GET /sync/disputes?cursor=<opaque>` → `{items: Dispute[], cursor}`
  - `GET /sync/wipe` → target-bound, signed, expiring app-data wipe command for verified managed Android only (ADR-0029)
  - `POST /sync/wipe/{id}/ack` → target DID reports `accepted` or native-handler `completed` (ADR-0029)
  - `GET /events` (SSE) → pushes `strike.created`, `runner.banned`, `dispute.updated`, `setting.changed`, and `wipe.pending` (managed Android only; ADR-0029)
  - `POST /disputes` (Customer submits draft → server creates row)
  - `POST /runners/claim` (Runner claims pre-created registry entry)
- **Auth**: All requests signed by requester's DID (Ed25519). Server verifies signature, maps to registry.
- **SSE**: Single persistent connection per app. Reconnects on Tor circuit rotation. `Last-Event-ID` for resume.
- **Rate limiting**: Per-DID, generous (sync is infrequent).
- **OpenAPI spec**: Publish at `/openapi.json` for client generation.

### Narrow extension — ADR-0029

The wipe sync/ack route and `wipe.pending` event are a later, narrowly scoped extension for
best-effort DAMZ app-data erasure on verified managed Android installations. They do not
extend to iOS or unmanaged Android, do not create a client-side table, and do not change the
19-table inventory. The command is Admin-CLI-issued, signed, target-bound, and expires.