import { Q, type Database } from '@nozbe/watermelondb';
import { PaymentEvent, TABLES } from './models';

/** The payment event shape persisted by the Runner inbox consumer. */
export interface GatewayPaymentNotificationRecord {
  type: 'payment.confirmed';
  eventId: string;
  issuedAt: number;
  orderId: string;
  subaddress: string;
  txid: string;
  amountPiconero: string;
  confirmations: number;
}

/**
 * WatermelonDB-backed replay store for the Runner's encrypted database.
 * `payment_events.detail` stores the event itself; the query plus create run in
 * one Watermelon writer so concurrent duplicate envelopes cannot both win.
 */
export class PaymentNotificationReplayStore {
  constructor(private readonly database: Database) {}

  /** Returns the most recent valid persisted Gateway event for crash recovery. */
  async getLatest(): Promise<GatewayPaymentNotificationRecord | null> {
    const rows = await this.database
      .get<PaymentEvent>(TABLES.PAYMENT_EVENTS)
      .query(
        Q.where('provider', 'gateway'),
        Q.where('kind', 'payment.confirmed'),
        Q.sortBy('observed_at', Q.desc),
        Q.take(20),
      )
      .fetch();

    for (const row of rows) {
      const notification = parseGatewayPaymentNotification(row.detail);
      if (notification) return notification;
    }
    return null;
  }

  async recordIfNew(notification: GatewayPaymentNotificationRecord): Promise<boolean> {
    let inserted = false;
    await this.database.write(async () => {
      const events = this.database.get<PaymentEvent>(TABLES.PAYMENT_EVENTS);
      const matchingRows = await events
        .query(
          Q.where('provider', 'gateway'),
          Q.where('kind', 'payment.confirmed'),
          Q.where('detail', Q.like(`%"eventId":"${notification.eventId}"%`)),
        )
        .fetch();

      if (
        matchingRows.some((row) => {
          try {
            return JSON.parse(row.detail ?? 'null')?.eventId === notification.eventId;
          } catch {
            return false;
          }
        })
      ) {
        return;
      }

      await events.create((row) => {
        row.orderId = notification.orderId;
        row.provider = 'gateway';
        row.kind = 'payment.confirmed';
        row.observedAt = notification.issuedAt * 1000;
        row.detail = JSON.stringify(notification);
      });
      inserted = true;
    });
    return inserted;
  }
}

function parseGatewayPaymentNotification(value: string | undefined): GatewayPaymentNotificationRecord | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const notification = parsed as Partial<GatewayPaymentNotificationRecord>;
  if (
    notification.type !== 'payment.confirmed' ||
    typeof notification.eventId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      notification.eventId,
    ) ||
    !Number.isSafeInteger(notification.issuedAt) ||
    (notification.issuedAt ?? 0) <= 0 ||
    typeof notification.orderId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      notification.orderId,
    ) ||
    typeof notification.subaddress !== 'string' ||
    notification.subaddress.length === 0 ||
    typeof notification.txid !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(notification.txid) ||
    typeof notification.amountPiconero !== 'string' ||
    !/^\d+$/.test(notification.amountPiconero) ||
    !Number.isSafeInteger(notification.confirmations) ||
    (notification.confirmations ?? 0) < 3
  ) {
    return null;
  }
  return notification as GatewayPaymentNotificationRecord;
}
