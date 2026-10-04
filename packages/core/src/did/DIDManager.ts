/**
 * DIDManager — Wrapper for @did-tools/key
 *
 * Generates and manages did:key identifiers (self-certifying, no ledger).
 */

import { DidKey } from '@did-tools/key';

export interface DIDKeyPair {
  did: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
  keyAgreement: string[];
  capabilityInvocation: string[];
  capabilityDelegation: string[];
}

export class DIDManager {
  private static instance: DIDManager;

  private constructor() {}

  static getInstance(): DIDManager {
    if (!DIDManager.instance) {
      DIDManager.instance = new DIDManager();
    }
    return DIDManager.instance;
  }

  async generateDID(): Promise<DIDKeyPair> {
    try {
      const { did, privateKey, publicKey } = await DidKey.generate({ algorithm: 'Ed25519' });
      return { did, privateKey, publicKey };
    } catch (error) {
      throw new Error(`Failed to generate DID: ${error}`);
    }
  }

  async resolveDID(did: string): Promise<DIDDocument | null> {
    try {
      if (!did.startsWith('did:key:')) {
        throw new Error('Only did:key supported');
      }

      const didKey = DidKey.fromDid(did);
      const publicKey = didKey.publicKey();

      return {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: did,
        verificationMethod: [{
          id: `${did}#keys-1`,
          type: 'Ed25519VerificationKey2020',
          controller: did,
          publicKeyMultibase: publicKey,
        }],
        authentication: [`${did}#keys-1`],
        assertionMethod: [`${did}#keys-1`],
        keyAgreement: [`${did}#keys-1`],
        capabilityInvocation: [`${did}#keys-1`],
        capabilityDelegation: [`${did}#keys-1`],
      };
    } catch (error) {
      throw new Error(`Failed to resolve DID: ${error}`);
    }
  }

  async sign(did: string, privateKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    try {
      const didKey = DidKey.fromDid(did);
      return await didKey.sign(privateKey, data);
    } catch (error) {
      throw new Error(`Failed to sign: ${error}`);
    }
  }

  async verify(did: string, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
    try {
      const didKey = DidKey.fromDid(did);
      return await didKey.verify(signature, data);
    } catch (error) {
      throw new Error(`Failed to verify: ${error}`);
    }
  }

  // Verify a DID-signed price list (ADR-0004)
  async verifyPriceListSignature(
    runnerDID: string,
    priceListData: string,
    signature: Uint8Array
  ): Promise<boolean> {
    const encoder = new TextEncoder();
    const data = encoder.encode(priceListData);
    return this.verify(runnerDID, signature, data);
  }
}