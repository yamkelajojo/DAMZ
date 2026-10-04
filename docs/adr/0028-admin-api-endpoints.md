# ADR-0028: Admin Service API Endpoints

**Status**: Accepted

## Context

Mobile apps need to sync mirrors (strikes, settings, directory, disputes) and submit disputes.

## Decision

Full REST + SSE API for mobile app sync and dispute management.

## Consequences

**Endpoints**:

```
GET  /sync/strikes?cursor=<opaque>          # Customer only
GET  /sync/settings?cursor=<opaque>         # Both apps
GET  /sync/directory?cursor=<opaque>        # Both apps (runner discovery)
GET  /sync/disputes?cursor=<opaque>         # Customer: own; Runner: against them
GET  /events (SSE)                          # Push: strike.created, runner.banned, dispute.updated, setting.changed
POST /disputes                              # Customer submits draft → server creates
POST /disputes/{id}/proof-key               # Customer shares proof key for admin review
POST /runners/claim                         # Runner claims pre-created registry entry
GET  /runners/me                            # Runner checks their registry status
```

**Auth**: All requests signed by requester's DID (Ed25519). Server verifies, maps to registry.
**Response**: `{data: T[], cursor: string, has_more: boolean}`
**SSE**: `Last-Event-ID` for resume on reconnect.