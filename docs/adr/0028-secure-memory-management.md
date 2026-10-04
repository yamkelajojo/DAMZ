# ADR-0028: Secure Memory Management for Native Wallets

**Status**: Accepted
**Date**: 2026-10-04
**Owner**: Admin/Developer

## Context

The Monero seed is protected at rest by Keychain/Keystore-backed secure storage, but the
current wallet wrapper exposes it to JavaScript. `packages/core/src/monero/MoneroWallet.ts`
returns the generated mnemonic as a `string` and accepts a seed as a `string` for restore.
JavaScript strings and JSI values cannot be reliably zeroized because garbage collection,
copying, and JIT/runtime behavior are outside the application's control. A forensic memory
dump while the app is unlocked could therefore recover a seed or other secret that has
passed through the JavaScript heap.

`DB_ARC_and_TEST_PLANNING.md` also allowed an optional private Monero view key to pass
through JavaScript `expo-secure-store`. The selected mobile-app boundary is stricter: no
Monero wallet secret—seed, spend key, or private view key—may enter a JavaScript-managed
value. This ADR does not change the existing view-only gateway design: the AcceptXMR
gateway holds a separately protected Runner private view key and never receives a spend
key (ADR-0009; `services/gateway/SPEC.md`).

The wallet is local to the user, not the Admin service. The accepted scope is now one
independent, device-local Monero wallet in each of the Customer and Runner apps. This
supersedes the Runner-only wallet placement recorded in refinement decision Q22; it adds no
central wallet and no central user database. The existing `wallet_metadata` client table is
used locally by each app, so the approved client schema remains at 19 tables.

The prior wallet decision called for a 24-word phrase, while the technical test-planning
document records the full 25-word Monero mnemonic. The selected contract is the native
Monero 25-word mnemonic as the complete user-visible backup and recovery phrase. ADR-0026
is superseded for phrase length only; its other Runner wallet UX decisions remain in force.

## Decision

Implement a native C/C++ module named `SecureMemory` as the wallet-secret boundary in both
mobile apps.

1. Each app owns its own wallet and on-device secrets. Customer wallet operations are
   local to the Customer app; Runner wallet operations are local to the Runner app. The
   Admin service holds no wallet or wallet secrets. The separate AcceptXMR gateway retains
   only the Runner's private view key in its protected view-only configuration and never
   receives a spend key (ADR-0009; `services/gateway/SPEC.md`).
2. On-device Monero seeds and spend keys remain protected at rest by the platform
   Keychain/Keystore, with biometric-only access in both apps and no PIN fallback. A
   private view key remains optional to persist locally; if persisted, it may use a
   PIN-derived HKDF key as a narrow exception, but PIN collection, derivation, and access
   occur only in native `SecureMemory`. Neither the PIN nor the key may enter JavaScript.
   Native code accesses secure storage directly; it must not retrieve plaintext through the
   JavaScript `expo-secure-store` API.
3. `SecureMemory` allocates native heap buffers for secret material, locks them with
   `mlock()` where supported, and exposes plaintext only inside the native module. Secret
   buffers must not be copied into JavaScript, JSI, or other JS-managed storage.
4. Seed- or key-dependent wallet operations—including generation, restoration, key
   derivation, signing, and transaction creation—run inside the native boundary. Seeds,
   spend keys, and private view keys are never returned to JavaScript as strings, JSI
   strings, typed arrays, or other JavaScript-managed values. JavaScript may receive only
   non-secret status and metadata needed by the UI.
5. The complete 25-word Monero mnemonic is the backup/recovery artifact. Phrase generation,
   display, and entry remain inside native UI/module code in both apps. JavaScript receives
   only completion state and non-secret metadata.
6. After each secret operation, the native module calls `secure_memset()` on each sensitive
   buffer before releasing it. Secret-bearing JSI/native handles are scoped, released
   promptly, and must not retain copies beyond the operation.

**Wallet-secret invariant:** the mnemonic seed, spend/private-view keys, and PIN used for
optional private-view-key derivation are never represented as a JavaScript string, JSI
string, JavaScript typed array, or any other JavaScript-managed value. No JavaScript-only
backup, recovery, key-access, or view-key exception is permitted.

## Alternatives Considered

- **Rely only on `expo-secure-store`** — rejected: it protects data at rest but its
  JavaScript-facing API returns plaintext into the JavaScript heap.
- **Zeroize JavaScript strings or buffers** — rejected: garbage collection, runtime copies,
  and JIT behavior make reliable erasure impossible.
- **Allow a JavaScript string for explicit backup or recovery** — rejected: it contradicts
  the wallet-secret invariant.
- **Keep a 24-word application-specific phrase** — rejected: the selected recovery artifact
  is the complete 25-word native Monero mnemonic, not a shortened or app-specific format.
- **Keep the wallet Runner-only** — rejected by the user in this refinement: both Customer
  and Runner apps have independent local wallets; no additional client table is introduced.
- **Allow the private view key through JavaScript because it is not the mnemonic** — rejected:
  private view keys are wallet secrets too and remain inside the same native boundary.
- **Require biometric-only access for an optional private view key** — rejected by the user;
  native PIN-derived HKDF protection is permitted for that key only. Seed and spend-key
  access remain biometric-only with no PIN fallback.

## Consequences

- Adds native C/C++ and platform-specific secure-storage integration complexity to both
  mobile apps.
- Requires native-only generation, backup display, recovery entry, key derivation, signing,
  and transaction creation. The current `MoneroWallet` TypeScript wrapper is noncompliant
  and must be replaced before production wallet operations; runtime code is not changed in
  this documentation-only directive.
- The existing `wallet_metadata` table is present in each app's own local database. It
  stores public wallet metadata only; the 19-table client inventory and separate Admin
  schema do not change.
- ADR-0026's 24-word phrase-length clause and refinement decision Q22's Runner-only wallet
  boundary are superseded by this ADR. Biometric-only access with no PIN fallback applies
  to seeds and spend keys in both apps. The optional private view key has a narrow exception:
  it may use a PIN-derived HKDF key, but only inside native `SecureMemory`; no wallet secret
  enters JavaScript. ADR-0026's Runner-specific duress PIN, subaddress labels, fee preview,
  and recovery-without-cloud-backup decisions remain for the Runner wallet and do not
  transfer to Customer by implication.
- `mlock()` and immediate zeroization reduce swapping and stale-buffer exposure; they do
  not prevent a privileged kernel attacker from reading live process memory. The threat
  model records that residual risk.
- This ADR specifies the architecture. The `SecureMemory` module and native UI are not yet
  implemented in this documentation-only phase.

## Open Questions

- **OQ-SEC-MEM-001**: Verify `mlock()` behavior and limits, the secure zeroization primitive,
  and the approved native fallback when memory locking is unavailable on the minimum
  Android and iOS versions. **Owner**: Admin/Developer. **Target resolution**: before
  Customer wallet onboarding in Phase 2 and Runner wallet onboarding in Phase 3.
- **OQ-SEC-MEM-002**: Define the native-only migration/access path for any existing
  Keychain/Keystore seed or view-key items so `SecureMemory` can retrieve them without
  routing plaintext through JavaScript. **Owner**: Admin/Developer. **Target resolution**:
  before Customer wallet onboarding in Phase 2 and Runner wallet onboarding in Phase 3.
