import type { RelayClient } from '../relay/RelayClient';
import {
  openPaymentNotification,
  type PaymentConfirmedNotification,
} from './PaymentNotificationCrypto';

/**
 * Durable, atomic deduplication boundary supplied by the app's encrypted DB.
 * Store the accepted event as part of `recordIfNew`; the stored event is the
 * recovery source if the app closes after receiving or acknowledging an item.
 */
export interface PaymentNotificationReplayStore {
  recordIfNew(notification: PaymentConfirmedNotification): Promise<boolean>;
}

export interface ReceivePaymentNotificationOptions {
  relay: Pick<RelayClient, 'receiveNext' | 'acknowledge'>;
  recipientOnionHash: string;
  gatewayDid: string;
  runnerDid: string;
  runnerEd25519PrivateKeyMultibase: string;
  replayStore: PaymentNotificationReplayStore;
}

/**
 * Peeks one opaque envelope, authenticates/decrypts it, persists the event ID,
 * and acknowledges the relay item in that order. If the app closes before the
 * database write or acknowledgement, the relay presents the same item again.
 * Duplicate events are acknowledged and return null. A durable replay store
 * is mandatory; an in-memory set is not safe here.
 */
export async function receiveNextPaymentNotification({
  relay,
  recipientOnionHash,
  gatewayDid,
  runnerDid,
  runnerEd25519PrivateKeyMultibase,
  replayStore,
}: ReceivePaymentNotificationOptions): Promise<PaymentConfirmedNotification | null> {
  const item = await relay.receiveNext(recipientOnionHash);
  if (item === null) return null;

  const notification = await openPaymentNotification(
    item.encryptedEnvelope,
    gatewayDid,
    runnerDid,
    runnerEd25519PrivateKeyMultibase,
  );
  const wasNew = await replayStore.recordIfNew(notification);
  await relay.acknowledge(recipientOnionHash, item.blobId);
  return wasNew ? notification : null;
}
