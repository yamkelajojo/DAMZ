# ADR-0029: Managed Android App-Data Remote Wipe

**Status**: Accepted (documentation decision; implementation deferred)
**Date**: 2026-10-04
**Owner**: Admin/Developer

## Context

Customer and Runner installations hold app-local identity, encrypted databases, Signal
material, and independent Monero wallet secrets. Existing lifecycle documentation describes
user-initiated deletion, but not a remote response to loss or compromise of a managed
Android installation. Adding an Admin-side command queue expands the previously
moderation-only Admin scope, so the boundary and limitations must be explicit.

The user selected **DAMZ app-data and key erasure only**. The feature does not factory-reset
the Android device. It is restricted to enrolled, managed Android installations; iOS and
unmanaged Android are outside this mechanism. The existing 19-table client schema and the
separate Admin schema remain in force.

## Decision

### 1. Scope and platform

- Both Customer and Runner apps may receive a wipe command only when the specific app
  installation is verified as an enrolled, managed Android device.
- Wiping removes DAMZ's app-private data and credentials from that installation. It does
  **not** factory-reset the device, erase unrelated applications, or reach iOS or unmanaged
  Android installations.
- The Admin service cannot erase data on another installation, a peer's device, a relay,
  an IPFS pin, the AcceptXMR gateway, or any external export or backup. In particular, this
  command does not remove the gateway's separately configured Runner view key (ADR-0009).

### 2. Bounded Admin control metadata

Add one Admin-only `wipe_pending` table as a narrow device-security control plane. This is
an explicit, limited extension to the Admin scope in ADR-0001, ADR-0007, and ADR-0041; it
does not authorize a central user database. The table is the Admin schema's sixth table,
not a WatermelonDB table, and does not change the 19-table client inventory.

The table stores only a pseudonymous app-installation DID, the target app role, fixed
`app_data` scope, a finite reason code, random command ID/nonce, issue and expiry times,
state timestamps, and command signature. Timestamps are UTC Unix seconds. It must not store
a device serial, advertising ID, contact details, location, order/chat/proof content, or
wallet material.

```sql
CREATE TABLE wipe_pending (
  id                 TEXT PRIMARY KEY, -- random command ID
  target_did         TEXT NOT NULL,    -- app-installation DID
  target_app         TEXT NOT NULL CHECK (target_app IN ('customer', 'runner')),
  scope              TEXT NOT NULL DEFAULT 'app_data' CHECK (scope = 'app_data'),
  reason_code        TEXT NOT NULL CHECK (
    reason_code IN ('device_lost', 'device_retired', 'security_incident')
  ),
  nonce              TEXT NOT NULL UNIQUE,
  issued_at          INTEGER NOT NULL, -- UTC Unix seconds
  expires_at         INTEGER NOT NULL, -- UTC Unix seconds
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'completed', 'cancelled', 'expired')),
  accepted_at        INTEGER,          -- UTC Unix seconds
  completed_at       INTEGER,          -- UTC Unix seconds
  requested_by       TEXT NOT NULL,    -- Admin DID
  command_signature  TEXT NOT NULL
);

CREATE INDEX idx_wipe_pending_target
  ON wipe_pending(target_did, target_app, status, expires_at);

CREATE UNIQUE INDEX idx_one_active_wipe_per_target
  ON wipe_pending(target_did, target_app)
  WHERE status IN ('pending', 'accepted');
```

At most one active (`pending` or `accepted`) command may exist per target DID/app role.
Both states expire no later than 72 hours after issue; the Admin expiry job transitions any
unfinished command to `expired`, so it can never block a later command indefinitely. Expiry
prevents command acceptance after the deadline. If accepted before expiry, the local
operation proceeds even if network delivery of its receipt later fails; the server marks an
unreported command expired and does not claim completion. Only a `pending` command may be
cancelled; once the target accepts it, the destructive operation cannot be revoked. Terminal records are retained in the live Admin table for at most 30 days for the narrow
operational audit, then purged. Encrypted Admin database backups can retain an earlier
snapshot until backup rotation; the production backup-retention limit is tracked as
OQ-SEC-WIPE-003. `completed` means the app reported that its native wipe handler completed;
it is not independent proof of forensic erasure.

### 3. Issuance, delivery, and replay protection

- The existing Admin CLI is the only command-issuance surface. Issuance requires Admin
  authentication, a typed confirmation of the exact target DID and app, a finite reason
  code, and verified managed-Android enrollment. No public HTTP endpoint may create a
  wipe command.
- The Admin CLI signs a canonical command containing command ID, target DID, app role,
  fixed scope, issue/expiry times, and nonce with the Admin Ed25519 identity. The private
  signing key stays outside the Admin database and repository; the mobile apps verify
  against the deployment's pinned Admin public DID.
- Delivery uses the existing DID-signed Admin API over Tor. For wipe fetch/ack requests,
  the app role (`customer` or `runner`) is included in the signed request payload and
  repeated in `X-DAMZ-App`; the server rejects a mismatch. The command is returned only to
  a request whose authenticated DID and app role match the target. An online app may
  receive a `wipe.pending` SSE event; it must also check on startup/resume so SSE is not a
  delivery dependency. No third-party push service or clearnet fallback is introduced.
- The app checks the Admin signature, target DID/role, fixed scope, managed-Android
  eligibility, expiry, and one-time nonce before invoking the native wipe handler.
  Duplicate delivery is idempotent. Expired, cancelled, invalidly signed, wrong-target,
  iOS, or unmanaged-device commands are rejected without wiping.
- A device first acknowledges `accepted`, then reports `completed` only after the native
  cleanup succeeds. The final DID-signed completion receipt is attempted after local
  database and wallet cleanup and before the app erases its remaining identity credential.
  If the device is offline or the receipt cannot be sent, the server must not claim
  `completed`; the local wipe still proceeds.

### 4. Local wipe contract

The Customer and Runner Android handlers must, in order:

1. Stop new wallet work, close active database handles, and zeroize every live wallet-secret
   buffer through native `SecureMemory` (ADR-0028).
2. Delete app-owned Android Keystore and secure-storage items, including that
   installation's Monero seed, spend key, optional private view key, SQLCipher key, Signal
   keys, and other DAMZ-only credentials. Keep the DID signing credential only until the
   final receipt in step 4. Wallet secrets remain native-only during this operation.
3. Delete the SQLCipher database and its WAL/SHM/journal sidecars, then app-private caches,
   temporary files, and app-owned local content. Delete encryption keys before attempting
   file removal so key destruction is the primary cryptographic-erasure control.
4. Send the completion receipt if possible using the remaining DID credential, delete that
   credential and any remaining app identity material, and terminate without recreating
   local state.

This is best-effort app-scope deletion, not a claim that flash storage can be forensically
sanitized. It does not delete user-exported copies, remote/peer copies, Admin moderation
records, relay or IPFS content, on-chain Monero history, or the separate AcceptXMR gateway
view-key configuration.

### 5. Alternatives considered

- **Factory-reset the entire Android device** — rejected: the selected scope is DAMZ app
  data and keys only; device reset would exceed the request and require a different
  management authority.
- **Support iOS or unmanaged Android in the same mechanism** — rejected: the accepted scope
  is enrolled, managed Android only. No equivalent behavior is implied for other platforms.
- **Add a client-side WatermelonDB wipe queue** — rejected: the command is Admin control
  metadata and must not add a client table or expand the 19-table inventory.
- **Claim guaranteed or forensic erasure** — rejected: an offline, force-stopped,
  uninstalled, or compromised device may not execute the command, and app-level deletion
  cannot guarantee physical flash sanitization.

## Consequences

- `services/admin/SPEC.md` and `DB_LAYOUT_AND_ARCH.md` document the sixth, Admin-only
  `wipe_pending` table and its target-bound sync/ack flow.
- ADR-0001, ADR-0007, and ADR-0041 remain valid except that their former moderation-only
  scope is narrowly extended by this ADR. Their exclusions of order, chat, and proof data
  and the prohibition on a central user database remain unchanged.
- Both mobile apps require a native Android app-data wipe handler integrated with
  `SecureMemory`. The 19 client tables and separate iOS behavior are unchanged.
- Remote wipe is best effort. Admin CLI status output must distinguish command acceptance
  from app-reported completion and must not imply that an offline device has been wiped.
- The design is documentation-only in this directive. Runtime implementation and tests
  remain deferred.

## Open Questions

- **OQ-SEC-WIPE-001**: Select and verify the Android Enterprise/MDM enrollment proof and
  app-installation-to-DID binding. A self-asserted `managed=true` flag is insufficient.
  **Owner**: Admin/Developer. **Target resolution**: before Phase 8 remote-wipe API
  acceptance and managed-Android rollout.
- **OQ-SEC-WIPE-002**: Validate native deletion of app-scoped Android Keystore items,
  SQLCipher files/sidecars, and app-private caches across the minimum supported Android
  versions, including interrupted-wipe behavior and truthful completion reporting.
  **Owner**: Admin/Developer. **Target resolution**: Customer Phase 2 and Runner Phase 3
  native-wipe gates, before Phase 8 end-to-end acceptance.
- **OQ-SEC-WIPE-003**: Set a finite retention limit for encrypted Admin database backups so
  terminal wipe-target DIDs do not persist indefinitely in snapshots. **Owner**:
  Admin/Developer. **Target resolution**: before Phase 8 production deployment.
