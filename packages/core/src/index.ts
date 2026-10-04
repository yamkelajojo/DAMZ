/**
 * @damz/core — Core Cryptographic & Protocol Primitives
 *
 * Exports:
 * - SignalProtocolStore (E2EE messaging storage)
 * - TorManager (react-native-nitro-tor wrapper)
 * - MoneroWallet (react-native-mymonero-core wrapper)
 * - ZKProofManager (@ajna-inc/poe-proofs wrapper)
 * - PhotoAttestation (@realreel/photo-attest wrapper)
 * - DIDManager (@did-tools/key wrapper)
 * - IPFSStorage (@ipfs-meshkit/meshkit + Helia wrapper)
 */

export { SignalProtocolStore } from './signal/SignalProtocolStore';
export type { IdentityKeyPair, PreKeyRecord, SessionRecord, SenderKeyRecord, SignalAddress } from './signal/SignalProtocolStore';

// Tor Manager
export { TorManager } from './tor/TorManager';

// Monero Wallet
export { MoneroWallet } from './monero/MoneroWallet';

// ZK Proof Manager
export { ZKProofManager } from './zk/ZKProofManager';

// Photo Attestation
export { PhotoAttestation } from './photo/PhotoAttestation';

// DID Manager
export { DIDManager } from './did/DIDManager';

// IPFS Storage
export { IPFSStorage } from './ipfs/IPFSStorage';