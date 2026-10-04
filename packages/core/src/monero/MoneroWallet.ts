/**
 * MoneroWallet — Wrapper for react-native-mymonero-core
 *
 * Handles wallet creation, subaddress generation, transaction creation, and balance sync.
 */

import bridge from 'react-native-mymonero-core';

export interface WalletInfo {
  address: string;
  seed: string;
  restoreHeight: number;
}

export interface SubaddressInfo {
  address: string;
  index: number;
  label: string;
}

export interface TransactionInfo {
  txid: string;
  amount: string;
  fee: string;
  timestamp: number;
  confirmations: number;
}

export class MoneroWallet {
  private static instance: MoneroWallet;
  private primaryAddress: string | null = null;
  private restoreHeight = 0;

  private constructor() {}

  static getInstance(): MoneroWallet {
    if (!MoneroWallet.instance) {
      MoneroWallet.instance = new MoneroWallet();
    }
    return MoneroWallet.instance;
  }

  async generateWallet(language: string = 'English'): Promise<WalletInfo> {
    const result = await bridge.generateWallet({ language, networkType: 'MAINNET' });
    this.primaryAddress = result.address;
    return {
      address: result.address,
      seed: result.mnemonic,
      restoreHeight: 0,
    };
  }

  async createWalletFromSeed(seed: string, restoreHeight: number = 0, language: string = 'English'): Promise<WalletInfo> {
    const result = await bridge.seedAndKeysFromMnemonic({ mnemonic: seed, language, networkType: 'MAINNET' });
    this.primaryAddress = result.address;
    this.restoreHeight = restoreHeight;
    return {
      address: result.address,
      seed,
      restoreHeight,
    };
  }

  async createSubaddress(accountIndex: number, label: string = ''): Promise<SubaddressInfo> {
    const result = await bridge.newIntegratedAddress({
      address: this.primaryAddress!,
      paymentId: label,
      networkType: 'MAINNET',
    });

    return {
      address: result.integratedAddress,
      index: accountIndex,
      label,
    };
  }

  async createTransaction(
    address: string,
    amount: string,
    priority: number = 1,
    unlockTime: number = 0
  ): Promise<{ txHex: string; txid: string; fee: string }> {
    const result = await bridge.createTransaction({
      address,
      amount: amount.toString(),
      priority,
      unlockTime,
      networkType: 'MAINNET',
    });

    return {
      txHex: result.signedTxHex,
      txid: result.txid,
      fee: result.fee.toString(),
    };
  }

  async decodeAddress(address: string): Promise<{ isValid: boolean; isSubaddress: boolean; networkType: string }> {
    const result = await bridge.decodeAddress({ address, networkType: 'MAINNET' });
    return {
      isValid: result.isValid,
      isSubaddress: result.isSubaddress,
      networkType: result.networkType,
    };
  }

  async estimateFee(amount: string, priority: number = 1): Promise<string> {
    const result = await bridge.estimateTxFee({
      amount: amount.toString(),
      priority,
      networkType: 'MAINNET',
    });
    return result.fee.toString();
  }

  getPrimaryAddress(): string | null {
    return this.primaryAddress;
  }

  getRestoreHeight(): number {
    return this.restoreHeight;
  }

  setRestoreHeight(height: number): void {
    this.restoreHeight = height;
  }
}