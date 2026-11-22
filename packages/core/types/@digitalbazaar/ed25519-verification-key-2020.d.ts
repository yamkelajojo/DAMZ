/**
 * Type shim for @digitalbazaar/ed25519-verification-key-2020@4.2.0, which ships
 * no `.d.ts` files.
 *
 * This describes the *real* API (verified against lib/Ed25519VerificationKey2020.js):
 *   - `generate` and `from` are **static** members of the class.
 *   - `export`, `signer`, `verifier` and `fingerprint` are **synchronous**.
 *   - `export()` throws unless `publicKey` and/or `privateKey` is requested, and
 *     it returns multibase **strings**, never raw `Uint8Array`s.
 *
 * The previous version of this file declared `generate`/`from` as instance
 * methods and `export`/`signer`/`verifier` as async, which made it typecheck to
 * write `new Ed25519VerificationKey2020()` (which throws at runtime) and
 * `instance.generate()` (a TypeError).
 */
declare module '@digitalbazaar/ed25519-verification-key-2020' {
  export interface Ed25519KeyPairExport {
    id?: string;
    type?: string;
    controller?: string;
    '@context'?: string;
    publicKeyMultibase?: string;
    privateKeyMultibase?: string;
    revoked?: boolean;
  }

  export interface Ed25519Signer {
    id?: string;
    sign(options: { data: Uint8Array }): Promise<Uint8Array>;
  }

  export interface Ed25519Verifier {
    id?: string;
    verify(options: { data: Uint8Array; signature: Uint8Array }): Promise<boolean>;
  }

  export interface Ed25519VerificationKey2020Options {
    publicKeyMultibase: string;
    privateKeyMultibase?: string;
    id?: string;
    controller?: string;
    type?: string;
  }

  export interface Ed25519VerificationKey2020 {
    readonly type: string;
    id?: string;
    controller?: string;
    publicKeyMultibase: string;
    privateKeyMultibase?: string;

    /** Returns `this.publicKeyMultibase` (the multibase fingerprint). */
    fingerprint(): string;
    /**
     * Serializes the key pair. Throws a `TypeError` unless at least one of
     * `publicKey`/`privateKey` is `true`.
     */
    export(options?: {
      publicKey?: boolean;
      privateKey?: boolean;
      includeContext?: boolean;
    }): Ed25519KeyPairExport;
    /** Throws at signing time when no private key is present. */
    signer(): Ed25519Signer;
    verifier(): Ed25519Verifier;
    verifyFingerprint(options: { fingerprint: string }): { valid: boolean; error?: Error };
    publicKey(): Uint8Array;
    privateKey(): Uint8Array;
  }

  export const Ed25519VerificationKey2020: {
    new (options: Ed25519VerificationKey2020Options): Ed25519VerificationKey2020;
    /** Static factory — the class cannot be constructed without key material. */
    generate(options?: {
      seed?: Uint8Array;
      id?: string;
      controller?: string;
    }): Promise<Ed25519VerificationKey2020>;
    /** Static factory. */
    from(options: Ed25519VerificationKey2020Options): Promise<Ed25519VerificationKey2020>;
    fromFingerprint(options: { fingerprint: string }): Ed25519VerificationKey2020;
    SUITE_CONTEXT: string;
  };
}
