/**
 * Type shim for @digitalbazaar/did-method-key@5.3.0, which ships no `.d.ts`
 * files. Mirrors lib/DidKeyDriver.js and lib/util.js.
 */
declare module '@digitalbazaar/did-method-key' {
  export interface DidKeyDriverUseOptions {
    multibaseMultikeyHeader: string;
    fromMultibase: (options: { publicKeyMultibase: string }) => unknown;
  }

  export interface DidKeyDriver {
    method: string;
    /**
     * Registers a multibase-multikey header (e.g. `z6Mk` for Ed25519) with a
     * deserializer. The driver throws `Unsupported "multibaseMultikeyHeader"`
     * from `get`/`fromKeyPair` for any header that was not registered.
     */
    use(options: DidKeyDriverUseOptions): void;
    fromKeyPair(options: {
      verificationKeyPair?: unknown;
      keyAgreementKeyPair?: unknown;
    }): Promise<{
      didDocument: any;
      keyPairs: Map<string, any>;
      methodFor: (options: { purpose: string }) => any;
    }>;
    get(options: { did?: string; url?: string }): Promise<any>;
    publicKeyToDidDoc(options: { publicKeyDescription: any }): Promise<{ didDocument: any }>;
    publicMethodFor(options: { didDocument: any; purpose: string }): any;
    computeId(options: { keyPair: any }): Promise<string>;
  }

  export const DidKeyDriver: {
    new (): DidKeyDriver;
  };

  /** Convenience factory equivalent to `new DidKeyDriver()`. */
  export function driver(): DidKeyDriver;

  /**
   * Builds a `fromMultibase` deserializer from a suite's `fromFingerprint`.
   */
  export function createFromMultibase(options: {
    fromFingerprint: (options: { fingerprint: string }) => unknown;
  }): (options: { publicKeyMultibase: string }) => Promise<unknown>;
}
