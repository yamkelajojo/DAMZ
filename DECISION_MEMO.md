# DAMZ Production Remediation — Decision Memo

**Branch**: arena/01a1062d-damz
**Date**: 2026-10-04
**Status**: Pre-implementation decision record

---

## Executive Summary

Four parallel research agents have completed their investigations. The findings are consistent and actionable. Key decisions required before implementation:

| Priority | Decision Required | Recommended Path |
|----------|-------------------|------------------|
| **P1: SQLCipher** | Choose adapter for Expo managed workflow | **Custom DatabaseAdapter wrapping expo-sqlite@57+ encryption** |
| **P2: Wallet Boundary** | Define native-only API shape; implement SecureMemory | **Replace MoneroWallet.ts with thin JS facade over native SecureMemory module** |
| **P3: TypeScript** | Fix 12 remaining diagnostics after deps installed | **Install deps; rewrite validator per ADR-0043; fix query/model typing** |

---

## Priority 1: Real SQLCipher Support — Decision

### Current State
- `@nozbe/watermelondbcipher@^0.27.0` **does not exist on npm** (HTTP 404)
- `packages/db/src/index.ts` imports standard `SQLiteAdapter` from `@nozbe/watermelondb/adapters/sqlite`
- Code passes `cipherKey` and calls `unsafeSqlQuery()` / `close()` — methods **not present** on standard adapter in WatermelonDB 0.27.0 types
- **No encryption is active** — DB either silently uses unencrypted SQLite or fails at runtime

### ADR Constraints
- **ADR-0043 OQ-SCHEMA-003**: Must confirm canonical SQLCipher adapter package/import/version/API before Phase 1 gate
- **REFINEMENT_SESSION**: "Do not claim local database encryption or release the migration until this is resolved and verified against the native adapter. Any replacement design requires a separate ADR and user confirmation."
- **DB_LAYOUT_AND_ARCH §7**: SQLCipher DB key in expo-secure-store, Keychain/Keystore, biometric-gated

### Viable Adapter Options (Agent A Findings)

| Option | Expo Managed | Type Coverage | Native Code | Maturity | Effort |
|--------|--------------|---------------|-------------|----------|--------|
| **expo-sqlite@57+ custom adapter** | ✅ Full | Write custom types | None (Expo handles) | High (Expo-supported) | Medium |
| ororsatti PR #1635 (JSI) | ❌ Bare only | Good (inherits WMDB) | C++/Swift/Kotlin | Medium (WIP, iOS tests fail) | High |
| 10play fork (legacy bridge) | ❌ Bare only | Good | ObjC/Kotlin | Low (passphrase not wired natively) | Medium |
| Fork WMDB 0.27.0 + PR #907 | ❌ Bare only | Full | C++/Swift/Kotlin | Low (stalled 2020) | High |

### **Decision: Custom DatabaseAdapter wrapping expo-sqlite@57+ encryption**

**Rationale:**
1. **Expo managed workflow compatible** — project uses expo-sqlite, expo-secure-store, expo-crypto
2. **Expo SDK 57+ officially supports encryption** via `openDatabaseSync(name, { encryptionKey })`
3. **No bare workflow migration required** — avoids CocoaPods/Gradle/CMake complexity
4. **Future-proof** — aligns with Expo's roadmap; no fork maintenance burden
5. **Agent A recommendation**: "Use expo-sqlite@57+ with custom DatabaseAdapter implementation (most future-proof, least native complexity)"

**Implementation Approach:**
- Implement `ExpoSQLiteAdapter` class conforming to WatermelonDB's `DatabaseAdapter` interface
- Use `expo-sqlite` sync API (`openDatabaseSync`, `execSync`, `querySync`, `closeSync`)
- Pass encryption key via `expo-secure-store` retrieval
- Implement required methods: `query`, `getChangedTables`, `unsafeExecute`, `close`, `batch`
- Map to WatermelonDB's expected callback-based async interface

**Risk Mitigation:**
- Write integration test proving DB file is unreadable without key
- Test v1→v2 SQLCipher upgrade on device/emulator
- No architecture change — adapter swap only

**Verified correction (2026-10-17) — encryption must be applied with `PRAGMA key`, not an open option:**

Rationale #2 above is inaccurate, and it was the root cause of an unencrypted database. Verified against the installed `expo-sqlite@57.0.3`:

- `SQLiteOpenOptions` (`build/NativeDatabase.d.ts`) contains only `enableChangeListener`, `useNewConnection`, `finalizeUnusedStatementsBeforeClosing` and `libSQLOptions`. There is **no** `key` and **no** `encryptionKey`.
- The string `encryptionKey` does not appear anywhere in the package (0 matches).
- `openDatabaseAsync` forwards unknown options to the native module, whose Android/iOS `OpenDatabaseOptions` records have no key field and whose C++ binding only wraps `sqlite3_open` — it never calls `sqlite3_key`. So `{ key }` / `{ encryptionKey }` are silently dropped and the file is written in plaintext.

The working mechanism is `PRAGMA key`, executed as the **first** statement after opening (SQLCipher refuses to key a file once a page has been read), while SQLCipher is compiled in at build time via the plugin option `useSQLCipher: true` (already present as `expo.sqlite.useSQLCipher=true` in `apps/customer/android/gradle.properties`).

- Implemented in `packages/db/src/adapters/ExpoSQLiteAdapter.ts` → `_applyEncryptionKey()`: applies `PRAGMA key = "x'<64-hex>'"` (raw 32-byte key, no KDF), verifies `PRAGMA cipher_version` is non-empty, and **throws** if SQLCipher is absent rather than silently falling back to a plaintext file.
- Covered by `TC-DB-SETUP` in `packages/db/src/__tests__/catalog-seeding.contract.test.ts`, including the SQLCipher-absent and malformed-key failure paths.

**Release gate (unchanged, still open):** an on-device/emulator test proving the database file is unreadable without the key, plus the v1→v2 SQLCipher upgrade test.

---

## Priority 2: Wallet Secret Boundary — Decision

### Current State
- `MoneroWallet.ts:11` — `WalletInfo` interface declares `seed: string`
- `MoneroWallet.ts:48` — `generateWallet()` returns `{ address, seed: result.mnemonic, restoreHeight }` — **SEED CROSSES NATIVE→JS**
- `MoneroWallet.ts:53-59` — `createWalletFromSeed(seed: string)` accepts seed, passes to native, returns it — **SEED CROSSES JS→NATIVE→JS**
- `react-native-mymonero-core` exposes `generateWallet` (returns mnemonic), `addressAndKeysFromMnemonic` (returns spendKey/viewKey), `mnemonicFromSeed`
- **Core wallet security test FAILS** — expects only `{ address, restoreHeight }`
- `SecureMemory` native module: **PLANNED, NOT IMPLEMENTED** (ADR-0028)

### ADR Constraints
- **ADR-0028 Wallet-secret invariant**: "The mnemonic seed, spend/private-view keys, and PIN used for optional private-view-key derivation are never represented as a JavaScript string, JSI string, JavaScript typed array, or any other JavaScript-managed value."
- **ADR-0028**: 25-word Monero mnemonic is canonical backup; generation/display/entry/restore native-only
- **ADR-0028**: Biometric-only for seed/spend key; no PIN fallback
- **ADR-0028 OQ-SEC-MEM-001**: Verify mlock/secure_memset behavior before wallet onboarding
- **ADR-0028 OQ-SEC-MEM-002**: Define native-only migration path for existing Keychain/Keystore items
- **REFINEMENT_SESSION C14/C15/C17**: Both Customer + Runner have independent local wallets; all secrets native-only; AcceptXMR gateway's separate Runner view key unchanged

### Leak Path Diagram (Agent B)
```
LEAK-001: generateWallet() → bridge.generateWallet() → result.mnemonic → JS string (line 48)
LEAK-002: createWalletFromSeed(seed) → JS string parameter → bridge.seedAndKeysFromMnemonic() (lines 53-54)
LEAK-003: createWalletFromSeed() return → { ..., seed } → caller (line 59)
```

### **Decision: Replace MoneroWallet.ts with thin JS facade over native SecureMemory module**

**Required Native API Shape (Agent B Proposal — Function Signatures Only):**

```typescript
// Native module: SecureMemory (JSI/TurboModule)
interface SecureMemory {
  // Wallet lifecycle — NO secrets in/out
  generateWallet(config: { language: string; networkType: string; biometricPrompt: string }): Promise<{ address: string; restoreHeight: number }>;
  restoreWallet(config: { mnemonicEntry: NativeMnemonicEntry; restoreHeight: number; networkType: string; biometricPrompt: string }): Promise<{ address: string; restoreHeight: number }>;
  hasWallet(): Promise<boolean>;
  deleteWallet(config: { biometricPrompt: string }): Promise<void>;

  // Operations — NO secrets in/out
  createSubaddress(config: { accountIndex: number; label: string }): Promise<{ address: string; index: number }>;
  createTransaction(config: { destinationAddress: string; amountPiconero: string; priority: number; unlockTime: number; biometricPrompt: string }): Promise<{ txHex: string; txid: string; fee: string }>;
  estimateFee(config: { amountPiconero: string; priority: number }): Promise<string>;
  decodeAddress(address: string): Promise<{ isValid: boolean; isSubaddress: boolean; networkType: string }>;

  // Metadata only
  getPrimaryAddress(): Promise<string>;
  getRestoreHeight(): Promise<number>;
  setRestoreHeight(height: number): Promise<void>;

  // Recovery phrase — NEVER crosses to JS
  exportRecoveryPhrase(config: { biometricPrompt: string; displayCallback: NativeDisplayCallback }): Promise<void>;
  verifyRecoveryPhrase(config: { biometricPrompt: string; entryCallback: NativeEntryCallback }): Promise<boolean>;

  // Optional view key — PIN-derived HKDF, native-only (ADR-0028 exception)
  getPrivateViewKey(config: { pinEntry: NativePinEntry; biometricPrompt?: string }): Promise<{ viewKey: OpaqueHandle }>;
  syncWithGateway(config: { gatewayOnion: string; viewKeyHandle: OpaqueHandle; lastSyncHeight: number }): Promise<{ newHeight: number; transactions: any[] }>;
}

// Opaque types — NEVER unwrapped in JS
type NativeMnemonicEntry = OpaqueHandle;
type NativePinEntry = OpaqueHandle;
type NativeDisplayCallback = (phrase: string) => void;  // Native UI calls this
type NativeEntryCallback = () => string;                // Native UI calls this
type OpaqueHandle = number;                             // Native-side handle only
```

**JS Facade (Replacement for MoneroWallet.ts):**
```typescript
// packages/core/src/monero/MoneroWallet.ts — NEW
import { NativeModules } from 'react-native';

const { SecureMemory } = NativeModules;

export interface WalletInfo {
  address: string;
  restoreHeight: number;
  // NO seed, NO mnemonic, NO spendKey, NO viewKey
}

export class MoneroWallet {
  static async generateWallet(language = 'English'): Promise<WalletInfo> {
    return SecureMemory.generateWallet({ language, networkType: 'MAINNET', biometricPrompt: 'Authenticate to create wallet' });
  }

  static async restoreWallet(mnemonicEntry: NativeMnemonicEntry, restoreHeight = 0): Promise<WalletInfo> {
    return SecureMemory.restoreWallet({ mnemonicEntry, restoreHeight, networkType: 'MAINNET', biometricPrompt: 'Authenticate to restore wallet' });
  }

  static async createSubaddress(accountIndex: number, label = ''): Promise<{ address: string; index: number }> {
    return SecureMemory.createSubaddress({ accountIndex, label });
  }

  // ... other methods proxy to SecureMemory, NO secret handling
}
```

**Migration Path for Existing Wallets (OQ-SEC-MEM-002):**
- SecureMemory reads existing Keychain/Keystore items natively
- No plaintext passes through JS during migration
- Biometric prompt required for any key access

---

## Priority 3: Clean TypeScript Diagnostics — Decision

### Current State (After `bun install`)
12 core diagnostics remain after dependency installation:

| Category | Count | Files | Fix Strategy |
|----------|-------|-------|--------------|
| Bun-specific (`import.meta.dir`) | 1 | `scripts/validate-schema.ts:14` | `import.meta.dirname` |
| Query callback typing | 1 | `src/index.ts:119` | Explicit `Query<Record>` type param |
| Catalog model generics | 2 | `src/index.ts:151,157` | Explicit `CatalogItem` type in `.create()` |
| Implicit `any` | 5 | `src/index.ts:57, 119, 151, 157` + adapter | Explicit parameter types |
| **ADR-0043 Validator** | 1 | `scripts/validate-schema.ts` | **Rewrite to inspect `TABLE_SCHEMA_SPECS` directly** |

### ADR Constraints
- **ADR-0043 OQ-SCHEMA-002**: Validator must inspect actual TypeScript `appSchema(...)` and fail on missing tables/columns
- **ADR-0043**: "The schema validator must validate the actual TypeScript WatermelonDB schema and its declared table/column inventory; it must not treat an empty SQL-regex parse as success."
- **Current validator**: Regex-parses `CREATE TABLE` from SQL — **NONCOMPLIANT**

### **Decision: Fix all 12 diagnostics with compliant implementations**

**Fixes:**
1. **`validate-schema.ts`**: Rewrite to import `TABLE_SCHEMA_SPECS` from `../schemas/schema` and validate against the actual TypeScript schema objects — not regex on SQL
2. **`src/index.ts:119`**: Type query callback: `.query((q: Query<Record>) => q.where('purge_after', q.lte(now)).where('dispute_state', q.notEq('open')))`
3. **`src/index.ts:151,157`**: Type create callbacks: `.create((record: CatalogItem) => { record._raw.id = item.id; ... })`
4. **`src/index.ts:57`**: `onSetUpError: (error: Error) => {`
5. **`import.meta.dir` → `import.meta.dirname`** (Bun API)
6. **Add `@types/node` and `@types/jest` to devDependencies** (already in package.json but need install)

**No `@ts-ignore`, no `as unknown as`, no loosening `tsconfig.json`** — per ground rules.

---

## Cross-Cutting Constraints Summary

| Constraint | Source | Impact on Implementation |
|------------|--------|-------------------------|
| Exactly 19 client tables + separate Admin schema | ADR-0043 | No schema changes; adapter swap only |
| Eight-item catalog including Grape Soda | ADR-0004/C20 | No catalog changes |
| R15/R20 are editable prefills, not floors | ADR-0004/C20 | No DB constraints/minimums |
| One additive v1→v2 migration | ADR-0043 OQ-SCHEMA-001 | Migration already implemented correctly |
| No seed/spendKey/privateViewKey in JS/JSI | ADR-0028 | Complete MoneroWallet.ts replacement |
| AcceptXMR Rust gateway is canonical | ADR-0009 | No MoneroPay/Node paths |
| Mopro/GPU additive; Zakura/CPU fallback | ADR-0030 | No ZK changes in this remediation |
| Remote wipe = managed Android app-data only | ADR-0029 | No wipe changes in this remediation |
| No `as any`, no fake adapters, no silenced diagnostics | Ground Rules | All fixes must be real |

---

## Implementation Sequence

### Phase 1: SQLCipher Adapter (P1)
1. Add `@types/node` and `@types/jest` to root devDependencies
2. Run `bun install`
3. Implement `ExpoSQLiteAdapter` in `packages/db/src/adapters/ExpoSQLiteAdapter.ts`
4. Update `packages/db/src/index.ts` to use new adapter with encryption key
5. Run typecheck → verify adapter-related diagnostics resolved
6. Write integration test: create encrypted DB, verify unreadable without key
7. **Device test**: v1→v2 SQLCipher upgrade on Android/iOS emulator

### Phase 2: Wallet Boundary (P2)
1. Define `SecureMemory` native module spec (TurboModule/JSI)
2. Implement iOS (Swift) and Android (Kotlin) native modules with:
   - Keychain/Keystore integration
   - `mlock()` + `secure_memset()` for buffers
   - Biometric-only auth for seed/spendKey
   - PIN-derived HKDF for optional view key (native-only)
   - Native UI for 25-word phrase display/entry
3. Replace `MoneroWallet.ts` with thin JS facade
4. Run wallet security test → verify PASS
5. **Device test**: wallet creation, backup, restore on device

### Phase 3: TypeScript Cleanup (P3)
1. Rewrite `validate-schema.ts` to inspect `TABLE_SCHEMA_SPECS` directly
2. Fix query callback typing, catalog model generics, implicit any
3. Fix `import.meta.dirname`
4. Run full `bun run typecheck` → 0 diagnostics
5. Run all test suites → all pass

---

## Approval Required

Before proceeding with implementation, confirm:

1. **SQLCipher Adapter**: Approve custom `ExpoSQLiteAdapter` implementation using expo-sqlite@57+ encryption (Expo managed workflow)?
2. **Wallet Boundary**: Approve SecureMemory native module spec and MoneroWallet.ts replacement approach?
3. **TypeScript**: Approve validator rewrite to inspect TypeScript schema objects per ADR-0043?

**If any decision requires a new security tradeoff or architecture change → STOP, write ADR proposal, record in REFINEMENT_SESSION.md, and ask.**