import { webcrypto } from 'node:crypto';
import { DIDManager } from '../did/DIDManager';
import {
  openPaymentNotification,
  sealPaymentNotification,
  type PaymentConfirmedNotification,
} from '../payments/PaymentNotificationCrypto';
import { receiveNextPaymentNotification } from '../payments/PaymentNotificationReceiver';

const notification: PaymentConfirmedNotification = {
  type: 'payment.confirmed',
  eventId: '123e4567-e89b-42d3-a456-426614174000',
  issuedAt: 1_800_000_000,
  orderId: '123e4567-e89b-42d3-a456-426614174001',
  subaddress: `8${'A'.repeat(94)}`,
  txid: 'a'.repeat(64),
  amountPiconero: '18517500000',
  confirmations: 3,
};

describe('payment notification HPKE envelope', () => {
  beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    }
  });

  it('seals payment data to the Runner and authenticates the pinned Gateway DID', async () => {
    const didManager = DIDManager.getInstance();
    const gateway = await didManager.generateDID();
    const runner = await didManager.generateDID();
    const envelope = await sealPaymentNotification(
      notification,
      gateway.did,
      gateway.privateKeyMultibase,
      runner.did,
    );

    expect(envelope).not.toContain(notification.orderId);
    await expect(
      openPaymentNotification(
        envelope,
        gateway.did,
        runner.did,
        runner.privateKeyMultibase,
      ),
    ).resolves.toEqual(notification);
    await expect(
      openPaymentNotification(
        envelope,
        (await didManager.generateDID()).did,
        runner.did,
        runner.privateKeyMultibase,
      ),
    ).rejects.toThrow();
  });

  it('persists each new event before acknowledging it and deduplicates redelivery', async () => {
    const didManager = DIDManager.getInstance();
    const gateway = await didManager.generateDID();
    const runner = await didManager.generateDID();
    const envelope = await sealPaymentNotification(
      notification,
      gateway.did,
      gateway.privateKeyMultibase,
      runner.did,
    );
    const handlingOrder: string[] = [];
    const relay = {
      receiveNext: jest.fn().mockResolvedValue({
        blobId: 'ce9dcece-61de-4a94-95f2-b7c48d8dd2dc',
        encryptedEnvelope: envelope,
      }),
      acknowledge: jest.fn().mockImplementation(async () => {
        handlingOrder.push('acknowledge');
      }),
    };
    const replayStore = {
      recordIfNew: jest
        .fn()
        .mockImplementationOnce(async () => {
          handlingOrder.push('persist');
          return true;
        })
        .mockImplementationOnce(async () => {
          handlingOrder.push('persist');
          return false;
        }),
    };
    const options = {
      relay,
      recipientOnionHash: 'a'.repeat(64),
      gatewayDid: gateway.did,
      runnerDid: runner.did,
      runnerEd25519PrivateKeyMultibase: runner.privateKeyMultibase,
      replayStore,
    };

    await expect(receiveNextPaymentNotification(options)).resolves.toEqual(notification);
    await expect(receiveNextPaymentNotification(options)).resolves.toBeNull();
    expect(replayStore.recordIfNew).toHaveBeenCalledTimes(2);
    expect(relay.acknowledge).toHaveBeenCalledTimes(2);
    expect(relay.acknowledge).toHaveBeenCalledWith(
      'a'.repeat(64),
      'ce9dcece-61de-4a94-95f2-b7c48d8dd2dc',
    );
    expect(handlingOrder).toEqual(['persist', 'acknowledge', 'persist', 'acknowledge']);
  });

  it('redelivers safely when durable persistence succeeds but acknowledgement fails', async () => {
    const didManager = DIDManager.getInstance();
    const gateway = await didManager.generateDID();
    const runner = await didManager.generateDID();
    const envelope = await sealPaymentNotification(
      notification,
      gateway.did,
      gateway.privateKeyMultibase,
      runner.did,
    );
    const relay = {
      receiveNext: jest.fn().mockResolvedValue({
        blobId: 'ce9dcece-61de-4a94-95f2-b7c48d8dd2dc',
        encryptedEnvelope: envelope,
      }),
      acknowledge: jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary relay failure'))
        .mockResolvedValueOnce(undefined),
    };
    const replayStore = {
      recordIfNew: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    };
    const options = {
      relay,
      recipientOnionHash: 'a'.repeat(64),
      gatewayDid: gateway.did,
      runnerDid: runner.did,
      runnerEd25519PrivateKeyMultibase: runner.privateKeyMultibase,
      replayStore,
    };

    await expect(receiveNextPaymentNotification(options)).rejects.toThrow(
      'temporary relay failure',
    );
    await expect(receiveNextPaymentNotification(options)).resolves.toBeNull();
    expect(replayStore.recordIfNew).toHaveBeenCalledTimes(2);
    expect(relay.acknowledge).toHaveBeenCalledTimes(2);
  });

  it('does not acknowledge an envelope that fails Gateway authentication', async () => {
    const relay = {
      receiveNext: jest.fn().mockResolvedValue({
        blobId: 'ce9dcece-61de-4a94-95f2-b7c48d8dd2dc',
        encryptedEnvelope: 'not-an-envelope',
      }),
      acknowledge: jest.fn().mockResolvedValue(undefined),
    };
    const replayStore = { recordIfNew: jest.fn().mockResolvedValue(true) };

    await expect(
      receiveNextPaymentNotification({
        relay,
        recipientOnionHash: 'a'.repeat(64),
        gatewayDid: 'did:key:trusted-gateway',
        runnerDid: 'did:key:runner',
        runnerEd25519PrivateKeyMultibase: 'zprivate-key',
        replayStore,
      }),
    ).rejects.toThrow(/not valid JSON/);
    expect(replayStore.recordIfNew).not.toHaveBeenCalled();
    expect(relay.acknowledge).not.toHaveBeenCalled();
  });
});
