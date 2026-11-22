/**
 * TC-DID-01 — did:key generation, resolution and signature round trip.
 *
 * These tests deliberately use the *real* `@digitalbazaar` libraries (nothing is
 * mocked). The previous implementation could not be tested this way because it
 * was broken in three independent ways:
 *   1. `new Ed25519VerificationKey2020()` throws — the suite cannot be built
 *      without key material, so `DIDManager` could not even be constructed.
 *   2. `generate()`/`from()` are *static* members; calling them on an instance is
 *      a `TypeError`.
 *   3. `export({publicKey: false})` throws, and `export()` returns multibase
 *      strings, not raw `Uint8Array`s.
 */
import { DIDManager } from '../did/DIDManager';

const encoder = new TextEncoder();

describe('TC-DID-01 — DIDManager did:key round trip', () => {
  it('generates a did:key identifier with matching multibase key material', async () => {
    const keyPair = await DIDManager.getInstance().generateDID();

    expect(keyPair.did.startsWith('did:key:z6Mk')).toBe(true);
    // `did:key:` embeds the multibase public key directly.
    expect(keyPair.did).toBe(`did:key:${keyPair.publicKeyMultibase}`);
    expect(keyPair.publicKeyMultibase.startsWith('z6Mk')).toBe(true);
    expect(keyPair.privateKeyMultibase).toMatch(/^z/);
    expect(keyPair.privateKeyMultibase).not.toBe(keyPair.publicKeyMultibase);
  });

  it('resolves its own DID document back to the same public key', async () => {
    const manager = DIDManager.getInstance();
    const { did, publicKeyMultibase } = await manager.generateDID();

    const document = await manager.resolveDID(did);

    expect(document).not.toBeNull();
    expect(document?.id).toBe(did);
    expect(document?.verificationMethod[0].publicKeyMultibase).toBe(publicKeyMultibase);
    expect(document?.verificationMethod[0].type).toBe('Ed25519VerificationKey2020');
    expect(document?.assertionMethod.length).toBeGreaterThan(0);
  });

  it('signs and verifies a price list payload (ADR-0004)', async () => {
    const manager = DIDManager.getInstance();
    const { did, privateKeyMultibase } = await manager.generateDID();
    const payload = JSON.stringify({ item: 'cabbage', pricePiconero: '1000000' });

    const signature = await manager.sign(did, privateKeyMultibase, encoder.encode(payload));

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64);
    await expect(manager.verifyPriceListSignature(did, payload, signature)).resolves.toBe(true);
  });

  it('rejects a signature over tampered data', async () => {
    const manager = DIDManager.getInstance();
    const { did, privateKeyMultibase } = await manager.generateDID();

    const signature = await manager.sign(did, privateKeyMultibase, encoder.encode('price=1'));

    await expect(manager.verify(did, signature, encoder.encode('price=2'))).resolves.toBe(false);
  });

  it('produces a signature only the owning DID can validate', async () => {
    const manager = DIDManager.getInstance();
    const alice = await manager.generateDID();
    const mallory = await manager.generateDID();
    const data = encoder.encode('authentic price list');

    // mallory signs with her key but claims alice's DID.
    const forged = await manager.sign(alice.did, mallory.privateKeyMultibase, data);

    await expect(manager.verify(alice.did, forged, data)).resolves.toBe(false);
  });

  it('refuses to resolve non-did:key identifiers', async () => {
    await expect(DIDManager.getInstance().resolveDID('did:web:example.com')).rejects.toThrow(
      /Only did:key supported/,
    );
  });

  it('rejects raw (non-multibase) private key bytes when signing', async () => {
    const manager = DIDManager.getInstance();
    const { did } = await manager.generateDID();

    await expect(
      manager.sign(did, 'not-a-multibase-key', encoder.encode('data')),
    ).rejects.toThrow(/Failed to sign/);
  });
});
