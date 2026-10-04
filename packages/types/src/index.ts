/**
 * @damz/types — Shared TypeScript Types & Zod Schemas
 *
 * Single source of truth for all domain types across apps and packages.
 * Derived from DB_LAYOUT_AND_ARCH.md schema.
 */

import { z } from 'zod';

// ============================================================================
// PRIMITIVE TYPES
// ============================================================================

export const DIDSchema = z.string().regex(/^did:key:z6Mk[a-zA-Z0-9]+$/);
export type DID = z.infer<typeof DIDSchema>;

export const OnionAddressSchema = z.string().regex(/^[a-z2-7]{56}\.onion$/);
export type OnionAddress = z.infer<typeof OnionAddressSchema>;

export const CIDSchema = z.string().regex(/^(Qm|bafy)[a-zA-Z0-9]{44,}$/);
export type CID = z.infer<typeof CIDSchema>;

export const MoneroAddressSchema = z.string().regex(/^[48][a-zA-Z0-9]{94}$/);
export type MoneroAddress = z.infer<typeof MoneroAddressSchema>;

export const MoneroSubaddressSchema = z.string().regex(/^8[a-zA-Z0-9]{94}$/);
export type MoneroSubaddress = z.infer<typeof MoneroSubaddressSchema>;

export const MoneroTxidSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type MoneroTxid = z.infer<typeof MoneroTxidSchema>;

export const MoneySchema = z.string().regex(/^\d+(\.\d{1,2})?$/);
export type Money = z.infer<typeof MoneySchema>; // Decimal string, e.g., "15.00"

export const TimestampSchema = z.number().int().positive();
export type Timestamp = z.infer<typeof TimestampSchema>;

export const UUIDSchema = z.string().uuid();
export type UUID = z.infer<typeof UUIDSchema>;

export const GeohashSchema = z.string().regex(/^[0-9a-z]{1,12}$/);
export type Geohash = z.infer<typeof GeohashSchema>;

// ============================================================================
// ENUMS
// ============================================================================

export const OrderStatusSchema = z.enum([
  'pending_payment',
  'paid',
  'accepted',
  'in_transit',
  'delivered',
  'confirmed',
  'cancelled',
  'expired',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const DisputeStateSchema = z.enum(['none', 'open', 'resolved', 'dismissed']);
export type DisputeState = z.infer<typeof DisputeStateSchema>;

export const PaymentEventKindSchema = z.enum(['requested', 'seen', 'confirmed', 'expired']);
export type PaymentEventKind = z.infer<typeof PaymentEventKindSchema>;

export const MessageDirectionSchema = z.enum(['inbound', 'outbound']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MessageDeliveryStateSchema = z.enum(['queued', 'sent', 'delivered', 'failed']);
export type MessageDeliveryState = z.infer<typeof MessageDeliveryStateSchema>;

export const VerificationResultSchema = z.enum(['accepted', 'rejected']);
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const DisputeReasonSchema = z.enum(['non_delivery', 'wrong_item', 'other']);
export type DisputeReason = z.infer<typeof DisputeReasonSchema>;

export const DisputeStatusSchema = z.enum(['draft', 'submitted', 'open', 'resolved', 'dismissed']);
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>;

export const StrikeReasonSchema = z.enum(['no_show', 'false_claim', 'abusive']);
export type StrikeReason = z.infer<typeof StrikeReasonSchema>;

export const CancelledBySchema = z.enum(['customer', 'runner']);
export type CancelledBy = z.infer<typeof CancelledBySchema>;

export const CancelReasonSchema = z.enum(['cannot_fulfil', 'customer_cancelled', 'payment_expired']);
export type CancelReason = z.infer<typeof CancelReasonSchema>;

export const CatalogItemIdSchema = z.enum([
  'cabbage',
  'spinach',
  'cinnamon',
  'cauliflower',
  'rock_salt',
  'flour',
  'bicarbonate_of_soda',
]);
export type CatalogItemId = z.infer<typeof CatalogItemIdSchema>;

export const PaymentProviderSchema = z.enum(['mock', 'moneropay', 'acceptxmr']);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

export const SyncSourceSchema = z.enum(['strikes', 'settings', 'directory', 'disputes']);
export type SyncSource = z.infer<typeof SyncSourceSchema>;

// ============================================================================
// DOMAIN MODELS (from DB_LAYOUT_AND_ARCH.md)
// ============================================================================

export const IdentitySchema = z.object({
  id: DIDSchema,
  did: DIDSchema,
  display_name: z.string().optional(),
  public_key: z.string(), // base64 encoded Ed25519 public key
  default_radius_km: z.number().positive().optional(),
  is_available: z.boolean().optional(),
  onion_address: OnionAddressSchema.optional(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Identity = z.infer<typeof IdentitySchema>;

export const ContactSchema = z.object({
  id: DIDSchema,
  did: DIDSchema,
  display_name: z.string().optional(),
  onion_address: OnionAddressSchema.optional(),
  signal_address: z.string().optional(), // Signal ProtocolAddress (name+deviceId)
  signal_identity_key: z.string().optional(), // base64
  last_seen_at: TimestampSchema.optional(),
  blocked: z.boolean().default(false),
  created_at: TimestampSchema,
});
export type Contact = z.infer<typeof ContactSchema>;

export const CatalogItemSchema = z.object({
  id: CatalogItemIdSchema,
  display_name: z.string(),
  sort_order: z.number().int(),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const PriceListSchema = z.object({
  id: z.string(), // '<runner_did>:<published_at>'
  runner_did: DIDSchema,
  published_at: TimestampSchema,
  delivery_fee_zar: MoneySchema.optional(),
  signature: z.string(), // base64 Ed25519 signature over canonical body
  fetched_at: TimestampSchema.optional(),
  is_current: z.boolean().default(true),
});
export type PriceList = z.infer<typeof PriceListSchema>;

export const RunnerPriceSchema = z.object({
  id: z.string(), // '<price_list_id>:<item_id>'
  price_list_id: z.string(),
  item_id: CatalogItemIdSchema,
  price_zar: MoneySchema,
  available: z.boolean().default(true),
});
export type RunnerPrice = z.infer<typeof RunnerPriceSchema>;

export const OrderSchema = z.object({
  id: UUIDSchema,
  customer_did: DIDSchema,
  runner_did: DIDSchema,
  status: OrderStatusSchema.default('pending_payment'),
  dispute_state: DisputeStateSchema.default('none'),
  // Money (Customer writes, Runner reads)
  total_zar: MoneySchema,
  delivery_fee_zar: MoneySchema.optional(),
  monero_subaddress: MoneroSubaddressSchema.optional(),
  payment_txid: MoneroTxidSchema.optional(),
  paid_at: TimestampSchema.optional(),
  expires_at: TimestampSchema.optional(),
  cancelled_by: CancelledBySchema.optional(),
  cancel_reason: CancelReasonSchema.optional(),
  // Delivery (Runner writes, Customer reads)
  delivery_geohash: GeohashSchema.optional(),
  proof_cid: CIDSchema.optional(),
  proof_key: z.string().optional(), // base64 AES-256-GCM key
  delivered_at: TimestampSchema.optional(),
  confirmed_at: TimestampSchema.optional(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  purge_after: TimestampSchema.optional(),
});
export type Order = z.infer<typeof OrderSchema>;

export const OrderItemSchema = z.object({
  id: UUIDSchema,
  order_id: UUIDSchema,
  item_id: CatalogItemIdSchema,
  display_name: z.string(),
  quantity: z.number().int().positive(),
  unit_price_zar: MoneySchema,
  line_total_zar: MoneySchema,
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const PaymentEventSchema = z.object({
  id: UUIDSchema,
  order_id: UUIDSchema,
  provider: PaymentProviderSchema,
  kind: PaymentEventKindSchema,
  observed_at: TimestampSchema,
  detail: z.string().optional(),
});
export type PaymentEvent = z.infer<typeof PaymentEventSchema>;

export const MessageSchema = z.object({
  id: UUIDSchema,
  order_id: UUIDSchema,
  direction: MessageDirectionSchema,
  sender_did: DIDSchema,
  recipient_did: DIDSchema,
  body: z.string().optional(),
  envelope: z.string().optional(), // base64 Signal envelope (outbox only)
  delivery_state: MessageDeliveryStateSchema.default('queued'),
  attempts: z.number().int().default(0),
  sent_at: TimestampSchema.optional(),
  received_at: TimestampSchema.optional(),
  read_at: TimestampSchema.optional(),
  purge_after: TimestampSchema.optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ProofBundleSchema = z.object({
  id: UUIDSchema,
  order_id: UUIDSchema,
  // Runner-written
  cid: CIDSchema,
  captured_at: TimestampSchema.optional(),
  capture_geohash: GeohashSchema.optional(),
  signature_valid: z.boolean().optional(),
  uploaded_at: TimestampSchema,
  // Customer-written
  verified_at: TimestampSchema.optional(),
  verification_result: VerificationResultSchema.optional(),
  verification_note: z.string().optional(),
  purge_after: TimestampSchema.optional(),
});
export type ProofBundle = z.infer<typeof ProofBundleSchema>;

export const WalletMetadataSchema = z.object({
  id: z.literal(1),
  primary_address: MoneroAddressSchema.optional(),
  account_index: z.number().int().default(0),
  restore_height: z.number().int().optional(),
  last_sync_height: z.number().int().optional(),
  last_sync_at: TimestampSchema.optional(),
});
export type WalletMetadata = z.infer<typeof WalletMetadataSchema>;

// Mirrors (read-only on device)
export const StrikeSchema = z.object({
  id: UUIDSchema,
  subject_did: DIDSchema,
  reason: StrikeReasonSchema,
  issued_at: TimestampSchema,
  acknowledged_at: TimestampSchema.optional(),
});
export type Strike = z.infer<typeof StrikeSchema>;

export const RunnerDirectorySchema = z.object({
  id: DIDSchema,
  runner_did: DIDSchema,
  display_name: z.string().optional(),
  onion_address: OnionAddressSchema,
  approved_at: TimestampSchema.optional(),
  banned_at: TimestampSchema.optional(),
  ban_reason: z.string().optional(),
  current_price_list_id: z.string().optional(),
  last_active_at: TimestampSchema.optional(),
});
export type RunnerDirectory = z.infer<typeof RunnerDirectorySchema>;

export const PlatformSettingSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
  updated_at: TimestampSchema,
});
export type PlatformSetting = z.infer<typeof PlatformSettingSchema>;

export const DisputeSchema = z.object({
  id: UUIDSchema,
  order_id: UUIDSchema,
  customer_did: DIDSchema,
  runner_did: DIDSchema,
  reason: DisputeReasonSchema,
  proof_cid: CIDSchema.optional(),
  proof_key_shared: z.boolean().default(false),
  status: DisputeStatusSchema.default('draft'),
  created_at: TimestampSchema,
  resolved_at: TimestampSchema.optional(),
  admin_response: z.string().optional(),
});
export type Dispute = z.infer<typeof DisputeSchema>;

export const SyncStateSchema = z.object({
  id: SyncSourceSchema,
  source: z.string(),
  last_success_at: TimestampSchema.optional(),
  cursor: z.string().optional(),
  last_error: z.string().optional(),
});
export type SyncState = z.infer<typeof SyncStateSchema>;

// ============================================================================
// API TYPES
// ============================================================================

export const PaymentRequestSchema = z.object({
  subaddress: MoneroSubaddressSchema,
  amountXmr: z.string(), // piconero as string
  expiresAt: TimestampSchema,
});
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

export const PaymentStatusSchema = z.enum(['pending', 'confirmed', 'expired']);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export interface PaymentProvider {
  requestPayment(order: Order): Promise<PaymentRequest>;
  checkStatus(orderId: UUID): Promise<PaymentStatus>;
  onPaymentUpdate: (orderId: UUID, status: 'confirmed' | 'expired') => void;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function createOrderId(): UUID {
  return crypto.randomUUID();
}

export function createPriceListId(runnerDID: DID, publishedAt: Timestamp): string {
  return `${runnerDID}:${publishedAt}`;
}

export function createRunnerPriceId(priceListId: string, itemId: CatalogItemId): string {
  return `${priceListId}:${itemId}`;
}

export function createMessageId(): UUID {
  return crypto.randomUUID();
}

export function createProofBundleId(): UUID {
  return crypto.randomUUID();
}

export function createStrikeId(): UUID {
  return crypto.randomUUID();
}

export function createDisputeId(): UUID {
  return crypto.randomUUID();
}

export function createSyncStateId(source: SyncSource): SyncSource {
  return source;
}