# ADR-0033: Admin Service API Endpoints

**Status**: Accepted

## Context

Mobile apps need to sync mirrors (strikes, settings, directory, disputes), submit disputes, and—under the later narrow extension ADR-0029—retrieve target-bound managed-Android app-data wipe commands.

## Decision

Full REST + SSE API for mobile app sync and dispute management.

## Consequences

**Endpoints**:

```
GET  /sync/strikes?cursor=<opaque>          # Customer only
GET  /sync/settings?cursor=<opaque>         # Both apps
GET  /sync/directory?cursor=<opaque>        # Both apps (runner discovery)
GET  /sync/disputes?cursor=<opaque>         # Customer: own; Runner: against them
GET  /sync/wipe                            # Verified managed Android target only (ADR-0029)
POST /sync/wipe/{id}/ack                   # Target DID: accepted/completed receipt (ADR-0029)
GET  /events (SSE)                          # Push: strike.created, runner.banned, dispute.updated, setting.changed, wipe.pending (Android only)
POST /disputes                              # Customer submits draft → server creates
POST /disputes/{id}/proof-key               # Customer shares proof key for admin review
POST /runners/claim                         # Runner claims pre-created registry entry
GET  /runners/me                            # Runner checks their registry status
```

**Auth**: All requests signed by requester's DID (Ed25519). Server verifies, maps to registry.
**Response**: `{data: T[], cursor: string, has_more: boolean}`
**SSE**: `Last-Event-ID` for resume on reconnect.

The `/sync/wipe`, wipe acknowledgement, and `wipe.pending` event are the limited extension
accepted in ADR-0029: Admin-CLI-created, Admin-signed, target-DID/app-bound, expiring
DAMZ app-data commands for verified managed Android only. The endpoint never exposes a
full-device reset and does not add a client table.