/**
 * @damz/core — Core Cryptographic & Protocol Primitives
 *
 * Exports:
 * - SignalProtocolStore (E2EE messaging storage)
 * - TorManager (react-native-nitro-tor wrapper)
 * - MoneroWallet (react-native-mymonero-core wrapper)
 * - ZKProofManager (@ajna-inc/poe-proofs wrapper)
 * - PhotoAttestation (@realreel/photo-attest wrapper)
 * - DIDManager (@digitalbazaar/did-method-key wrapper)
 * - IPFSStorage (@ipfs-meshkit/meshkit + Helia wrapper)
 */

export { SignalProtocolStore } from './signal/SignalProtocolStore';
export type { IdentityKeyPair, PreKeyRecord, SessionRecord, SenderKeyRecord, SignalAddress } from './signal/SignalProtocolStore';

// Tor Manager
export { TorManager } from './tor/TorManager';

// Opaque encrypted message transport over a Tor hidden service.
export { RelayClient } from './relay/RelayClient';
export type { RelayInboxItem, RelayReceipt, RelayTransport } from './relay/RelayClient';

// Authenticated end-to-end encrypted payment event envelopes.
export {
  openPaymentNotification,
  sealPaymentNotification,
  MAX_PAYMENT_NOTIFICATION_BYTES,
} from './payments/PaymentNotificationCrypto';
export type {
  HpkeEnvelope,
  PaymentConfirmedNotification,
} from './payments/PaymentNotificationCrypto';
export { receiveNextPaymentNotification } from './payments/PaymentNotificationReceiver';
export type {
  PaymentNotificationReplayStore,
  ReceivePaymentNotificationOptions,
} from './payments/PaymentNotificationReceiver';

// Monero Wallet
export { MoneroWallet } from './monero/MoneroWallet';

// ZK Proof Manager
export { ZKProofManager } from './zk/ZKProofManager';

// Photo Attestation
export { PhotoAttestation } from './photo/PhotoAttestation';

// DID Manager
export { DIDManager } from './did/DIDManager';
export type { DIDKeyPair } from './did/DIDManager';

// IPFS Storage
export { IPFSStorage } from './ipfs/IPFSStorage';
