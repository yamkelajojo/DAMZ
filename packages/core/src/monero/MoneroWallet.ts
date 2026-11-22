/**
 * MoneroWallet — JavaScript façade over native SecureMemory module
 *
 * ADR-0028 Invariant: The mnemonic seed, spend/private-view keys, and PIN
 * used for optional private-view-key derivation are NEVER represented as
 * a JavaScript string, JSI string, JavaScript typed array, or any other
 * JavaScript-managed value.
 *
 * All wallet secrets remain in native memory (Keychain/Keystore + mlock).
 * Biometric authentication required for any secret access.
 * 25-word Monero mnemonic is canonical backup; display/entry/restore native-only.
 */

import { NativeModules } from 'react-native';

type SecureMemoryNativeModule = NonNullable<typeof NativeModules.SecureMemory>;

function requireSecureMemory(): SecureMemoryNativeModule {
  const nativeModule = NativeModules.SecureMemory as SecureMemoryNativeModule | undefined;
  if (nativeModule) return nativeModule;

  throw new Error(
    'SecureMemory native module is unavailable. Wallet operations are disabled ' +
      'until the iOS and Android native implementations are installed.'
  );
}

export interface WalletInfo {
  address: string;
  restoreHeight: number;
  // NO seed, NO mnemonic, NO spendKey, NO privateViewKey
}

export interface SubaddressInfo {
  address: string;
  index: number;
  label: string;
}

export interface TransactionResult {
  txHex: string;
  txid: string;
  fee: string;
}

export interface DecodedAddress {
  isValid: boolean;
  isSubaddress: boolean;
  networkType: string;
}

export interface FeeEstimate {
  fee: string;
}

/**
 * Opaque handle types — NEVER unwrapped in JavaScript.
 * These are native-side references only.
 * Using nominal typing via unique symbol brands.
 */
type OpaqueHandle = number & { readonly __brand: unique symbol };

type NativeMnemonicEntry = OpaqueHandle & { readonly __mnemonicBrand: unique symbol };
type NativePinEntry = OpaqueHandle & { readonly __pinBrand: unique symbol };
type NativeViewKeyHandle = OpaqueHandle & { readonly __viewKeyBrand: unique symbol };

export class MoneroWallet {
  private static instance: MoneroWallet;

  private constructor() {}

  static getInstance(): MoneroWallet {
    if (!MoneroWallet.instance) {
      MoneroWallet.instance = new MoneroWallet();
    }
    return MoneroWallet.instance;
  }

  /**
   * Generate a new wallet. Seed never leaves native memory.
   * Biometric authentication required.
   */
  async generateWallet(language: string = 'English'): Promise<WalletInfo> {
    const result = await requireSecureMemory().generateWallet({
      language,
      networkType: 'MAINNET',
      biometricPrompt: 'Authenticate to create wallet',
    });
    return {
      address: result.address,
      restoreHeight: result.restoreHeight,
    };
  }

  /**
   * Restore wallet from mnemonic. Mnemonic entry is native-only.
   * Biometric authentication required.
   */
  async restoreWallet(
    mnemonicEntry: NativeMnemonicEntry,
    restoreHeight: number = 0
  ): Promise<WalletInfo> {
    const result = await requireSecureMemory().restoreWallet({
      mnemonicEntry,
      restoreHeight,
      networkType: 'MAINNET',
      biometricPrompt: 'Authenticate to restore wallet',
    });
    return {
      address: result.address,
      restoreHeight: result.restoreHeight,
    };
  }

  /**
   * Check if wallet exists on device.
   */
  async hasWallet(): Promise<boolean> {
    return requireSecureMemory().hasWallet();
  }

  /**
   * Delete wallet. Biometric authentication required.
   */
  async deleteWallet(): Promise<void> {
    await requireSecureMemory().deleteWallet({
      biometricPrompt: 'Authenticate to delete wallet',
    });
  }

  /**
   * Create a new subaddress. No secrets exposed.
   */
  async createSubaddress(accountIndex: number, label: string = ''): Promise<SubaddressInfo> {
    return requireSecureMemory().createSubaddress({ accountIndex, label });
  }

  /**
   * Create a transaction. Biometric authentication required for signing.
   * Returns unsigned transaction hex + txid + fee.
   */
  async createTransaction(
    destinationAddress: string,
    amountPiconero: string,
    priority: number = 1,
    unlockTime: number = 0
  ): Promise<TransactionResult> {
    return requireSecureMemory().createTransaction({
      destinationAddress,
      amountPiconero,
      priority,
      unlockTime,
      biometricPrompt: 'Authenticate to sign transaction',
    });
  }

  /**
   * Estimate transaction fee. No secrets involved.
   */
  async estimateFee(amountPiconero: string, priority: number = 1): Promise<string> {
    return requireSecureMemory().estimateFee({ amountPiconero, priority });
  }

  /**
   * Decode/validate an address. No secrets involved.
   */
  async decodeAddress(address: string): Promise<DecodedAddress> {
    return requireSecureMemory().decodeAddress(address);
  }

  /**
   * Get primary wallet address. No secrets.
   */
  getPrimaryAddress(): Promise<string> {
    return requireSecureMemory().getPrimaryAddress();
  }

  /**
   * Get wallet restore height. No secrets.
   */
  getRestoreHeight(): Promise<number> {
    return requireSecureMemory().getRestoreHeight();
  }

  /**
   * Set wallet restore height. No secrets.
   */
  setRestoreHeight(height: number): Promise<void> {
    return requireSecureMemory().setRestoreHeight(height);
  }

  /**
   * Export the recovery phrase (25-word mnemonic).
   *
   * ADR-0028: the phrase never enters JavaScript. Native renders its own
   * non-copyable, non-screenshotable view; this promise resolves once that view
   * is dismissed and the native buffer has been zeroed. There is deliberately no
   * callback through which the mnemonic could reach JS — the previous
   * `displayCallback: (phrase: string) => void` parameter handed the seed to
   * JavaScript and contradicted this file's own invariant.
   * Biometric authentication required.
   */
  async exportRecoveryPhrase(biometricPrompt: string): Promise<void> {
    await requireSecureMemory().exportRecoveryPhrase({ biometricPrompt });
  }

  /**
   * Verify a recovery phrase.
   *
   * ADR-0028: native collects the phrase through its own UI and compares it in
   * native memory, returning only a boolean — never the entered phrase.
   * Biometric authentication required.
   */
  async verifyRecoveryPhrase(biometricPrompt: string): Promise<boolean> {
    return requireSecureMemory().verifyRecoveryPhrase({ biometricPrompt });
  }

  /**
   * Get private view key (PIN-derived HKDF, native-only).
   * ADR-0028 exception: optional view key for gateway sync, derived from PIN + biometric.
   * Returns opaque handle — NEVER the actual key material.
   */
  async getPrivateViewKey(
    pinEntry: NativePinEntry,
    biometricPrompt?: string
  ): Promise<{ viewKeyHandle: NativeViewKeyHandle }> {
    return requireSecureMemory().getPrivateViewKey({ pinEntry, biometricPrompt });
  }

  /**
   * Sync with AcceptXMR gateway using view key handle.
   * No secrets in JavaScript — opaque handle passed to native.
   */
  async syncWithGateway(
    gatewayOnion: string,
    viewKeyHandle: NativeViewKeyHandle,
    lastSyncHeight: number
  ): Promise<{ newHeight: number; transactions: any[] }> {
    return requireSecureMemory().syncWithGateway({
      gatewayOnion,
      viewKeyHandle,
      lastSyncHeight,
    });
  }
}
