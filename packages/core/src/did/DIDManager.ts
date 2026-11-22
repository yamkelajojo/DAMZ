/**
 * DIDManager — Wrapper for @digitalbazaar/did-method-key
 *
 * Generates and manages did:key identifiers (self-certifying, no ledger).
 *
 * ADR-0002: the DID is the client's root identity. The Ed25519 key pair is the
 * only key material; `did:key` encodes the public key directly in the
 * identifier, so resolution never hits the network.
 *
 * Note on key formats: `Ed25519VerificationKey2020` represents keys as
 * *multibase* strings (`z…`, base58btc with a multicodec header) — never as raw
 * `Uint8Array`s. `export()` returns those strings and `from()` expects them.
 * Raw bytes are only available through the suite's `publicKey()`/`privateKey()`
 * accessors; the string form is what every other digitalbazaar API consumes.
 */

import { DidKeyDriver } from '@digitalbazaar/did-method-key';
import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';

export interface DIDKeyPair {
  did: string;
  /**
   * Multibase-encoded (base58btc, `z`-prefixed) Ed25519 public key. This is
   * also the DID's multibase fingerprint.
   */
  publicKeyMultibase: string;
  /**
   * Multibase-encoded (base58btc, `z`-prefixed) Ed25519 private key.
   * The caller is responsible for persisting this in platform secure storage
   * (e.g. expo-secure-store with biometric gating); it must never be logged.
   */
  privateKeyMultibase: string;
}

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: {
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }[];
  authentication: string[];
  assertionMethod: string[];
  keyAgreement: string[];
  capabilityInvocation: string[];
  capabilityDelegation: string[];
}

/** The subset of the resolved DID document that this wrapper consumes. */
interface ResolvedDIDDocument {
  '@context'?: string[];
  id: string;
  verificationMethod: {
    id: string;
    type: string;
    controller?: string;
    publicKeyMultibase: string;
  }[];
  authentication?: string[];
  assertionMethod?: string[];
  keyAgreement?: { id: string }[];
  capabilityInvocation?: string[];
  capabilityDelegation?: string[];
}

export class DIDManager {
  private static instance: DIDManager;
  private didKeyDriver: DidKeyDriver;

  private constructor() {
    this.didKeyDriver = new DidKeyDriver();
    // Register the Ed25519VerificationKey2020 suite for the `z6Mk…` multibase
    // header. The driver resolves keys by re-creating the suite through this
    // callback, so the callback itself must be the *static* `from` factory —
    // `Ed25519VerificationKey2020` cannot be instantiated without key material.
    this.didKeyDriver.use({
      multibaseMultikeyHeader: 'z6Mk',
      fromMultibase: ({ publicKeyMultibase }: { publicKeyMultibase: string }) =>
        Ed25519VerificationKey2020.from({ publicKeyMultibase }),
    });
  }

  static getInstance(): DIDManager {
    if (!DIDManager.instance) {
      DIDManager.instance = new DIDManager();
    }
    return DIDManager.instance;
  }

  async generateDID(): Promise<DIDKeyPair> {
    try {
      const keyPair = await Ed25519VerificationKey2020.generate();

      const { didDocument } = await this.didKeyDriver.fromKeyPair({
        verificationKeyPair: keyPair,
      });

      const did = didDocument.id;

      // `export()` throws unless `publicKey`/`privateKey` is requested, and it
      // returns multibase strings (not raw bytes). The previous implementation
      // called `export({publicKey: false})` — which always threw — and typed the
      // result as `Uint8Array`.
      const { publicKeyMultibase, privateKeyMultibase } = keyPair.export({
        publicKey: true,
        privateKey: true,
      });

      if (!publicKeyMultibase || !privateKeyMultibase) {
        throw new Error('Ed25519 key export returned incomplete key material');
      }

      return { did, publicKeyMultibase, privateKeyMultibase };
    } catch (error) {
      throw new Error(`Failed to generate DID: ${error}`);
    }
  }

  async resolveDID(did: string): Promise<DIDDocument | null> {
    try {
      if (!did.startsWith('did:key:')) {
        throw new Error('Only did:key supported');
      }

      const resolved = (await this.didKeyDriver.get({ did })) as ResolvedDIDDocument;

      // Return the document the driver actually produced rather than a
      // hand-built one: the real ids embed the multibase fingerprints and the
      // keyAgreement entry is an object, not a `#keys-1` style fragment.
      return {
        '@context': resolved['@context'] ?? ['https://www.w3.org/ns/did/v1'],
        id: resolved.id,
        verificationMethod: resolved.verificationMethod.map((method) => ({
          id: method.id,
          type: method.type,
          controller: method.controller ?? resolved.id,
          publicKeyMultibase: method.publicKeyMultibase,
        })),
        authentication: resolved.authentication ?? [],
        assertionMethod: resolved.assertionMethod ?? [],
        keyAgreement: (resolved.keyAgreement ?? []).map((key) => key.id),
        capabilityInvocation: resolved.capabilityInvocation ?? [],
        capabilityDelegation: resolved.capabilityDelegation ?? [],
      };
    } catch (error) {
      throw new Error(`Failed to resolve DID: ${error}`);
    }
  }

  /**
   * Sign `data` with the DID's Ed25519 private key.
   *
   * @param did The `did:key:…` identifier that owns the key.
   * @param privateKeyMultibase The multibase private key returned by
   *   {@link generateDID}. Raw bytes are rejected: `privateKeyMultibase` must be
   *   a `z…`-prefixed multibase string.
   * @param data The bytes to sign.
   */
  async sign(
    did: string,
    privateKeyMultibase: string,
    data: Uint8Array
  ): Promise<Uint8Array> {
    try {
      const resolved = (await this.didKeyDriver.get({ did })) as ResolvedDIDDocument;
      const { publicKeyMultibase } = resolved.verificationMethod[0];

      // `from()` is a *static* factory. It validates the multibase headers but
      // does not cross-check that the private key matches the public key, so a
      // mismatched pair yields a signature that simply fails verification.
      const keyPair = await Ed25519VerificationKey2020.from({
        publicKeyMultibase,
        privateKeyMultibase,
      });

      const signer = keyPair.signer();
      return await signer.sign({ data });
    } catch (error) {
      throw new Error(`Failed to sign: ${error}`);
    }
  }

  async verify(
    did: string,
    signature: Uint8Array,
    data: Uint8Array
  ): Promise<boolean> {
    try {
      const resolved = (await this.didKeyDriver.get({ did })) as ResolvedDIDDocument;
      const { publicKeyMultibase } = resolved.verificationMethod[0];

      const keyPair = await Ed25519VerificationKey2020.from({
        publicKeyMultibase,
      });

      const verifier = keyPair.verifier();
      return await verifier.verify({ data, signature });
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
