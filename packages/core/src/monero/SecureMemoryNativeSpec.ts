/**
 * SecureMemory Native Module Specification
 * 
 * This defines the TurboModule/JSI interface that the native modules (iOS Swift, Android Kotlin)
 * must implement. All wallet secrets remain in native memory — NEVER cross to JavaScript.
 * 
 * ADR-0028 Requirements:
 * - mlock() + secure_memset() for all secret buffers
 * - Keychain (iOS) / Keystore (Android) for persistent storage
 * - Biometric-only auth for seed/spendKey access (no PIN fallback)
 * - PIN-derived HKDF for optional view key (native-only, ADR-0028 exception)
 * - 25-word mnemonic display/entry via native UI only
 * - Opaque handles for all secret references passed to/from JS
 */

export interface SecureMemorySpec {
  // Wallet lifecycle — NO secrets in/out
  generateWallet(config: {
    language: string;
    networkType: string;
    biometricPrompt: string;
  }): Promise<{ address: string; restoreHeight: number }>;

  restoreWallet(config: {
    mnemonicEntry: NativeMnemonicEntry;
    restoreHeight: number;
    networkType: string;
    biometricPrompt: string;
  }): Promise<{ address: string; restoreHeight: number }>;

  hasWallet(): Promise<boolean>;

  deleteWallet(config: { biometricPrompt: string }): Promise<void>;

  // Operations — NO secrets in/out
  createSubaddress(config: { accountIndex: number; label: string }): Promise<{ address: string; index: number }>;

  createTransaction(config: {
    destinationAddress: string;
    amountPiconero: string;
    priority: number;
    unlockTime: number;
    biometricPrompt: string;
  }): Promise<{ txHex: string; txid: string; fee: string }>;

  estimateFee(config: { amountPiconero: string; priority: number }): Promise<string>;

  decodeAddress(address: string): Promise<{ isValid: boolean; isSubaddress: boolean; networkType: string }>;

  // Metadata only
  getPrimaryAddress(): Promise<string>;
  getRestoreHeight(): Promise<number>;
  setRestoreHeight(height: number): Promise<void>;

  // Recovery phrase — NEVER crosses to JS.
  // Native renders its own UI and zeroes the buffer; no callbacks carry key
  // material, so the mnemonic cannot be observed from JavaScript.
  exportRecoveryPhrase(config: {
    biometricPrompt: string;
  }): Promise<void>;

  // Native UI prompts for phrase entry and validates it in native memory,
  // returning only a boolean.
  verifyRecoveryPhrase(config: {
    biometricPrompt: string;
  }): Promise<boolean>;

  // Optional view key — PIN-derived HKDF, native-only (ADR-0028 exception)
  // Returns opaque handle — NEVER the actual key material
  getPrivateViewKey(config: {
    pinEntry: NativePinEntry;
    biometricPrompt?: string;
  }): Promise<{ viewKeyHandle: NativeViewKeyHandle }>;

  // Sync with AcceptXMR gateway using view key handle
  // No secrets in JavaScript — opaque handle passed to native
  syncWithGateway(config: {
    gatewayOnion: string;
    viewKeyHandle: NativeViewKeyHandle;
    lastSyncHeight: number;
  }): Promise<{ newHeight: number; transactions: any[] }>;
}

// Opaque types — NEVER unwrapped in JavaScript
// These are native-side integer handles only
export type NativeMnemonicEntry = number & { readonly __brand: unique symbol };
export type NativePinEntry = number & { readonly __brand: unique symbol };
export type NativeViewKeyHandle = number & { readonly __brand: unique symbol };

// NOTE: there are deliberately no "display/entry callback" types here. Any
// callback that carries the mnemonic would expose it as a JavaScript string,
// violating the ADR-0028 invariant this module exists to enforce.

// iOS Implementation Notes (Swift):
//
// class SecureMemory: NSObject, SecureMemorySpec {
//   private let keychain = KeychainWrapper.standard
//   private var walletState: WalletState?
//   
//   func generateWallet(config: GenerateWalletConfig) async throws -> WalletInfo {
//     // 1. Show biometric prompt (LAContext)
//     // 2. Generate 25-word mnemonic using Monero lib
//     // 3. Derive spend key, view key, primary address
//     // 4. Store mnemonic + keys in Keychain with kSecAttrAccessibleWhenUnlockedThisDeviceOnly + biometryAny
//     // 5. mlock() secret buffers, secure_memset() on dealloc
//     // 6. Return { address, restoreHeight: 0 }
//   }
//   
//   func restoreWallet(config: RestoreWalletConfig) async throws -> WalletInfo {
//     // 1. Show biometric prompt
//     // 2. Native UI collects 25-word mnemonic (native text entry, no JS)
//     // 3. Validate mnemonic, derive keys, store in Keychain
//     // 4. Return { address, restoreHeight }
//   }
//   
//   func exportRecoveryPhrase(config: ExportRecoveryPhraseConfig) async throws {
//     // 1. Show biometric prompt
//     // 2. Retrieve mnemonic from Keychain
//     // 3. Render the phrase in a native, non-copyable, non-screenshotable view
//     // 4. secure_memset() mnemonic buffer after display; resolve Void (no phrase to JS)
//   }
//   
//   func getPrivateViewKey(config: GetPrivateViewKeyConfig) async throws -> ViewKeyHandle {
//     // 1. Show biometric prompt (optional)
//     // 2. Native UI collects the PIN (native entry, no JS)
//     // 3. HKDF-SHA256(pin, salt) -> viewKey
//     // 4. Store viewKey in Keychain, return opaque handle
//   }
// }
//
// Android Implementation Notes (Kotlin):
//
// class SecureMemoryModule : ReactContextBaseJavaModule(), SecureMemorySpec {
//   private val keyStore = KeyStore.getInstance("AndroidKeyStore")
//   private val biometricPrompt = BiometricPrompt(...)
//   
//   @ReactMethod
//   fun generateWallet(config: GenerateWalletConfig, promise: Promise) {
//     // 1. BiometricPrompt.authenticate()
//     // 2. On success: generate mnemonic, derive keys
//     // 3. Store in AndroidKeyStore with setUserAuthenticationRequired(true)
//     // 4. promise.resolve(mapOf("address" to address, "restoreHeight" to 0))
//   }
//   
//   @ReactMethod
//   fun exportRecoveryPhrase(config: ExportRecoveryPhraseConfig, promise: Promise) {
//     // 1. BiometricPrompt.authenticate()
//     // 2. On success: retrieve mnemonic from KeyStore
//     // 3. Show native AlertDialog with phrase (non-copyable, non-screenshotable)
//     // 4. Zero-out the native char array; promise.resolve() (no phrase to JS)
//   }
// }
//
// OQ-SEC-MEM-001: Verify mlock/secure_memset behavior before wallet onboarding
// OQ-SEC-MEM-002: Define native-only migration path for existing Keychain/Keystore items