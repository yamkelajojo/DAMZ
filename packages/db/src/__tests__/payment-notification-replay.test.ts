import type { Database } from '@nozbe/watermelondb';
import { PaymentNotificationReplayStore } from '../payment-notification-replay';

const notification = {
  type: 'payment.confirmed' as const,
  eventId: '123e4567-e89b-42d3-a456-426614174000',
  issuedAt: 1_800_000_000,
  orderId: '123e4567-e89b-42d3-a456-426614174001',
  subaddress: `8${'A'.repeat(94)}`,
  txid: 'a'.repeat(64),
  amountPiconero: '18517500000',
  confirmations: 3,
};

describe('PaymentNotificationReplayStore', () => {
  it('restores the latest valid event after the relay item was consumed', async () => {
    const collection = {
      query: jest.fn(() => ({
        fetch: jest.fn(async () => [{ detail: JSON.stringify(notification) }]),
      })),
    };
    const database = {
      get: jest.fn(() => collection),
    } as unknown as Database;
    const store = new PaymentNotificationReplayStore(database);

    await expect(store.getLatest()).resolves.toEqual(notification);
  });

  it('persists an event once in the encrypted Runner payment-event table', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const collection = {
      query: jest.fn(() => ({ fetch: jest.fn(async () => rows) })),
      create: jest.fn(async (createRecord: (row: Record<string, unknown>) => void) => {
        const row: Record<string, unknown> = {};
        createRecord(row);
        rows.push(row);
        return row;
      }),
    };
    const database = {
      write: jest.fn(async (writer: () => Promise<void>) => writer()),
      get: jest.fn(() => collection),
    } as unknown as Database;
    const store = new PaymentNotificationReplayStore(database);

    await expect(store.recordIfNew(notification)).resolves.toBe(true);
    await expect(store.recordIfNew(notification)).resolves.toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orderId: notification.orderId,
      provider: 'gateway',
      kind: 'payment.confirmed',
      observedAt: notification.issuedAt * 1000,
      detail: JSON.stringify(notification),
    });
    expect(database.write).toHaveBeenCalledTimes(2);
  });
});
