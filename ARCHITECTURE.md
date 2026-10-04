# DAMZ Architecture

**Version**: 1.0
**Status**: v2 architecture reference with security decisions recorded through ADR-0029
**Last Updated**: 2026-10-04
**Owner**: Admin/Developer

This document summarizes the approved v2 system boundaries and records the secure-memory
architecture. It does not replace the detailed technical specification or schema. The
source documents are `SPEC.md`, `DB_LAYOUT_AND_ARCH.md`, `THREAT-MODEL.md`, and the ADRs in
`docs/adr/`.

## 1. System Shape

DAMZ has two local-first mobile applications and one bounded Admin service:

- **Customer app** holds the Customer's independent local Monero wallet, places orders,
  pays, communicates with a Runner, and confirms delivery.
- **Runner app** holds the Runner's independent local Monero wallet, publishes signed
  prices, and fulfils orders.
- **Admin service** is a Tor-hidden Rust service authoritative for runner registry, bans,
strikes, disputes, and platform settings. Under ADR-0029 it also stores the minimal,
pseudonymous `wipe_pending` command metadata for best-effort DAMZ app-data erasure on
verified managed Android installations only. It does not store wallet secrets or wallet
state, order, chat, or proof content, and it is not a central user database. The Admin
schema is separate from the 19-table client schema.

Customer and Runner devices keep their own SQLCipher-protected databases and independent
wallets; neither complete wallet is shared or held by the Admin service. On-device wallet
secrets remain in platform secure storage and are accessed only through native code. The
AcceptXMR gateway separately holds the Runner's private view key in protected view-only
configuration and never receives a spend key (ADR-0009; `services/gateway/SPEC.md`). Each
device's database contains only that device's non-secret wallet metadata. The apps exchange
order information and messages through Signal Protocol over Tor. Delivery evidence is
created on the Runner device, encrypted before upload, and retrieved by the Customer using
information shared over the order chat. The Admin receives dispute evidence only when a
Customer voluntarily shares it.

The service topology and complete order lifecycle remain as defined in `SPEC.md` and
`DB_LAYOUT_AND_ARCH.md`. This summary does not change the anonymity model or the bounded
Admin-service boundary.

## 2. Trust Boundaries

1. **Device boundary**: local identity, order, wallet, and message state is protected by
   SQLCipher and platform secure storage. Secret operations must remain native where the
   JavaScript runtime cannot provide reliable erasure.
2. **Peer communication boundary**: Signal Protocol protects message content; Tor carries
   application traffic. Relays handle opaque encrypted payloads only.
3. **Admin boundary**: the Admin service stores moderation state in its separate server
   schema. It never becomes the store of Customer identity, order, chat, or proof content.
4. **Blob-storage boundary**: delivery proof bundles are encrypted on the device before
   storage. A content identifier alone does not provide the decryption key.

## 3. Secure Memory Management (ADR-0028)

On-device Keychain/Keystore storage protects local Monero wallet secrets at rest, but the
existing JavaScript-facing `expo-secure-store` path returns plaintext to JavaScript. This
applies to the mnemonic seed and any locally persisted spend or private-view key. It is
insufficient for the in-memory threat: JavaScript strings and JSI values cannot be reliably
zeroized, and garbage collection or runtime copies can extend a secret's lifetime beyond
the wallet operation. The AcceptXMR gateway's separate encrypted Runner view key remains a
server-side, view-only exception under ADR-0009; it is outside the mobile JavaScript boundary.

The accepted design introduces a native C/C++ module named `SecureMemory`:

1. Wallet secrets stay encrypted in the platform Keychain/Keystore-backed secure storage.
2. `SecureMemory` accesses that storage through native APIs and exposes wallet-secret
   plaintext only in native heap buffers. It must not call the JavaScript `expo-secure-store`
   API to obtain a seed, spend key, or private view key.
3. The native module locks sensitive buffers with `mlock()` where supported, then performs
   Monero seed- or key-dependent operations—including derivation, signing, and transaction
   creation—without exposing wallet secrets to JavaScript.
4. Immediately after the operation, the native module calls `secure_memset()` to
   zeroize the sensitive buffer before releasing it. JSI/native handles are scoped and
   released promptly so they cannot retain secret copies.
5. The complete 25-word Monero mnemonic remains available for backup and recovery through
   a native-only interface in both apps. Phrase generation, display, and entry occur in
   native UI/module code; JavaScript receives only completion state and non-secret
   metadata.

**Invariant:** neither app's Monero seed, spend key, private view key, nor the optional
private-view-key PIN is ever represented as a JavaScript string, JSI string, JavaScript
typed array, or other JavaScript-managed value. Only non-secret results such as an address,
fee, transaction identifier, or operation status may cross back to JavaScript.

Seed and spend-key access is biometric-only with no PIN fallback. If an optional private
view key is persisted, the narrow PIN-derived HKDF path is handled wholly in native code;
the PIN itself never crosses into JavaScript.

`mlock()` and immediate zeroization reduce swapping and stale-buffer exposure; they do not
make live native memory unreadable to a privileged kernel-level attacker. This limit is
recorded in `THREAT-MODEL.md`.

**Implementation status:** this is an accepted architectural decision, not an implemented
module. The current `MoneroWallet` TypeScript scaffold returns and accepts the seed as a
string and does not satisfy this boundary for either app. It must be replaced before
production wallet operations. Platform support and native secure-storage migration are
tracked as Open Questions in ADR-0028, with resolution required before the Customer and
Runner wallet onboarding phases.

## 4. Managed Android Remote App-Data Wipe (ADR-0029)

A verified, enrolled managed Android Customer or Runner installation may receive a
one-time, Admin-Ed25519-signed, expiring wipe command. The Admin CLI creates the command;
`wipe_pending` is the sixth table in the separate Admin schema, not a new client table. The
service returns a command only to the matching app-installation DID and role over the
existing DID-signed Admin API and Tor. `wipe.pending` is a wake-up hint; apps also check on
startup/resume. iOS and unmanaged Android are excluded.

The command's scope is fixed to DAMZ app-private data and keys, not an operating-system
factory reset. The native handler stops wallet work, zeroizes live wallet-secret buffers
through `SecureMemory`, deletes local wallet, Signal, and SQLCipher credentials, closes
and removes the encrypted database and sidecars, and clears app-private caches. It keeps
the DID signing credential only long enough to send the completion receipt after cleanup,
then deletes it. The receipt is an app report, not independent verification. This is best effort: offline or force-stopped devices may not receive
it, and the app's receipt is not proof of physical flash sanitization. It cannot reach
external exports, other installations, Admin moderation records, remote relay/IPFS data,
or the AcceptXMR gateway's separate view-key configuration. Enrollment-proof and native
wipe-interruption validation remain implementation gates in ADR-0029.

## 5. Related Documents

- `SPEC.md` — component choices and end-to-end system flows.
- `DB_LAYOUT_AND_ARCH.md` — client-side schema, ownership, storage, and Admin schema.
- `THREAT-MODEL.md` — adversaries, security properties, and residual risks.
- `docs/adr/0028-secure-memory-management.md` — secure-memory decision and implementation
  constraints.
- `docs/adr/0029-managed-android-app-data-remote-wipe.md` — managed-Android app-data wipe
  scope, Admin queue, limitations, and implementation gates.
- `services/admin/SPEC.md` — separate Admin API and six-table schema, including `wipe_pending`.
