/**
 * WatermelonDB Models — DAMZ Database
 *
 * Each model corresponds to a table in the schema.
 * Role-scoped writes enforced at application layer.
 */

import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly, children } from '@nozbe/watermelondb/decorators';
import { Associations } from '@nozbe/watermelondb/Model';

export class Identity extends Model {
  static table = 'identity';
  static associations: Associations = {
    contacts: { type: 'has_many', foreignKey: 'did' },
  };

  @text('did') did!: string;
  @text('display_name') displayName!: string | undefined;
  @text('public_key') publicKey!: string;
  @field('default_radius_km') defaultRadiusKm!: number | undefined;
  @field('is_available') isAvailable!: boolean | undefined;
  @text('onion_address') onionAddress!: string | undefined;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  @children('contacts') contacts!: any;
}

export class Contact extends Model {
  static table = 'contacts';
  static associations: Associations = {
    identity: { type: 'belongs_to', key: 'did' },
    ordersAsCustomer: { type: 'has_many', foreignKey: 'customer_did' },
    ordersAsRunner: { type: 'has_many', foreignKey: 'runner_did' },
    messages: { type: 'has_many', foreignKey: 'sender_did' },
  };

  @text('did') did!: string;
  @text('display_name') displayName!: string | undefined;
  @text('onion_address') onionAddress!: string | undefined;
  @text('signal_address') signalAddress!: string | undefined;
  @text('signal_identity_key') signalIdentityKey!: string | undefined;
  @field('last_seen_at') lastSeenAt!: number | undefined;
  @field('blocked') blocked!: boolean;
  @date('created_at') createdAt!: Date;
}

export class CatalogItem extends Model {
  static table = 'catalog_items';
  static associations: Associations = {
    runnerPrices: { type: 'has_many', foreignKey: 'item_id' },
    orderItems: { type: 'has_many', foreignKey: 'item_id' },
  };

  @text('display_name') displayName!: string;
  @field('sort_order') sortOrder!: number;
}

export class PriceList extends Model {
  static table = 'price_lists';
  static associations: Associations = {
    runnerPrices: { type: 'has_many', foreignKey: 'price_list_id' },
    orders: { type: 'has_many', foreignKey: 'price_list_id' },
  };

  @text('runner_did') runnerDid!: string;
  @field('published_at') publishedAt!: number;
  @text('delivery_fee_zar') deliveryFeeZar!: string | undefined;
  @text('signature') signature!: string;
  @field('fetched_at') fetchedAt!: number | undefined;
  @field('is_current') isCurrent!: boolean;
}

export class RunnerPrice extends Model {
  static table = 'runner_prices';
  static associations: Associations = {
    priceList: { type: 'belongs_to', key: 'price_list_id' },
    item: { type: 'belongs_to', key: 'item_id' },
  };

  @text('price_list_id') priceListId!: string;
  @text('item_id') itemId!: string;
  @text('price_zar') priceZar!: string;
  @field('available') available!: boolean;
}

export class Order extends Model {
  static table = 'orders';
  static associations: Associations = {
    items: { type: 'has_many', foreignKey: 'order_id' },
    messages: { type: 'has_many', foreignKey: 'order_id' },
    paymentEvents: { type: 'has_many', foreignKey: 'order_id' },
    proofBundles: { type: 'has_many', foreignKey: 'order_id' },
    disputes: { type: 'has_many', foreignKey: 'order_id' },
  };

  @text('customer_did') customerDid!: string;
  @text('runner_did') runnerDid!: string;
  @text('status') status!: string;
  @text('dispute_state') disputeState!: string;

  // Money (Customer writes)
  @text('total_zar') totalZar!: string;
  @text('delivery_fee_zar') deliveryFeeZar!: string | undefined;
  @text('monero_subaddress') moneroSubaddress!: string | undefined;
  @text('payment_txid') paymentTxid!: string | undefined;
  @field('paid_at') paidAt!: number | undefined;
  @field('expires_at') expiresAt!: number | undefined;
  @text('cancelled_by') cancelledBy!: string | undefined;
  @text('cancel_reason') cancelReason!: string | undefined;

  // Delivery (Runner writes)
  @text('delivery_geohash') deliveryGeohash!: string | undefined;
  @text('proof_cid') proofCid!: string | undefined;
  @text('proof_key') proofKey!: string | undefined;
  @field('delivered_at') deliveredAt!: number | undefined;
  @field('confirmed_at') confirmedAt!: number | undefined;

  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
  @field('purge_after') purgeAfter!: number | undefined;
}

export class OrderItem extends Model {
  static table = 'order_items';
  static associations: Associations = {
    order: { type: 'belongs_to', key: 'order_id' },
    item: { type: 'belongs_to', key: 'item_id' },
  };

  @text('order_id') orderId!: string;
  @text('item_id') itemId!: string;
  @text('display_name') displayName!: string;
  @field('quantity') quantity!: number;
  @text('unit_price_zar') unitPriceZar!: string;
  @text('line_total_zar') lineTotalZar!: string;
}

export class PaymentEvent extends Model {
  static table = 'payment_events';
  static associations: Associations = {
    order: { type: 'belongs_to', key: 'order_id' },
  };

  @text('order_id') orderId!: string;
  @text('provider') provider!: string;
  @text('kind') kind!: string;
  @field('observed_at') observedAt!: number;
  @text('detail') detail!: string | undefined;
}

export class Message extends Model {
  static table = 'messages';
  static associations: Associations = {
    order: { type: 'belongs_to', key: 'order_id' },
  };

  @text('order_id') orderId!: string;
  @text('direction') direction!: string;
  @text('sender_did') senderDid!: string;
  @text('recipient_did') recipientDid!: string;
  @text('body') body!: string | undefined;
  @text('envelope') envelope!: string | undefined;
  @text('delivery_state') deliveryState!: string;
  @field('attempts') attempts!: number;
  @field('sent_at') sentAt!: number | undefined;
  @field('received_at') receivedAt!: number | undefined;
  @field('read_at') readAt!: number | undefined;
  @field('purge_after') purgeAfter!: number | undefined;
}

export class ProofBundle extends Model {
  static table = 'proof_bundles';
  static associations: Associations = {
    order: { type: 'belongs_to', key: 'order_id' },
  };

  @text('order_id') orderId!: string;
  @text('cid') cid!: string;
  @field('captured_at') capturedAt!: number | undefined;
  @text('capture_geohash') captureGeohash!: string | undefined;
  @field('signature_valid') signatureValid!: boolean | undefined;
  @field('uploaded_at') uploadedAt!: number;
  @field('verified_at') verifiedAt!: number | undefined;
  @text('verification_result') verificationResult!: string | undefined;
  @text('verification_note') verificationNote!: string | undefined;
  @field('purge_after') purgeAfter!: number | undefined;
}

export class WalletMetadata extends Model {
  static table = 'wallet_metadata';

  @text('primary_address') primaryAddress!: string | undefined;
  @field('account_index') accountIndex!: number;
  @field('restore_height') restoreHeight!: number | undefined;
  @field('last_sync_height') lastSyncHeight!: number | undefined;
  @field('last_sync_at') lastSyncAt!: number | undefined;
}

export class Strike extends Model {
  static table = 'strikes';

  @text('subject_did') subjectDid!: string;
  @text('reason') reason!: string;
  @field('issued_at') issuedAt!: number;
  @field('acknowledged_at') acknowledgedAt!: number | undefined;
}

export class RunnerDirectory extends Model {
  static table = 'runner_directory';
  static associations: Associations = {
    priceLists: { type: 'has_many', foreignKey: 'runner_did' },
  };

  @text('runner_did') runnerDid!: string;
  @text('display_name') displayName!: string | undefined;
  @text('onion_address') onionAddress!: string;
  @field('approved_at') approvedAt!: number | undefined;
  @field('banned_at') bannedAt!: number | undefined;
  @text('ban_reason') banReason!: string | undefined;
  @text('current_price_list_id') currentPriceListId!: string | undefined;
  @field('last_active_at') lastActiveAt!: number | undefined;
}

export class PlatformSetting extends Model {
  static table = 'platform_settings';

  @text('key') key!: string;
  @text('value') value!: string;
  @field('updated_at') updatedAt!: number;
}

export class Dispute extends Model {
  static table = 'disputes';

  @text('order_id') orderId!: string;
  @text('customer_did') customerDid!: string;
  @text('runner_did') runnerDid!: string;
  @text('reason') reason!: string;
  @text('proof_cid') proofCid!: string | undefined;
  @field('proof_key_shared') proofKeyShared!: boolean;
  @text('status') status!: string;
  @field('created_at') createdAt!: number;
  @field('resolved_at') resolvedAt!: number | undefined;
  @text('admin_response') adminResponse!: string | undefined;
}

export class SyncState extends Model {
  static table = 'sync_state';

  @text('source') source!: string;
  @field('last_success_at') lastSuccessAt!: number | undefined;
  @text('cursor') cursor!: string | undefined;
  @text('last_error') lastError!: string | undefined;
}

// All models array for database initialization
export const MODELS = [
  Identity,
  Contact,
  CatalogItem,
  PriceList,
  RunnerPrice,
  Order,
  OrderItem,
  PaymentEvent,
  Message,
  ProofBundle,
  WalletMetadata,
  Strike,
  RunnerDirectory,
  PlatformSetting,
  Dispute,
  SyncState,
];

export const CUSTOMER_MODELS = MODELS; // Customer app gets all tables

// Runner app excludes strikes table
export const RUNNER_MODELS = MODELS.filter(m => m.table !== 'strikes');