import { isOnionUrl, TorManager } from '../tor/TorManager';

const DEFAULT_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_RELAY_BLOB_BYTES = 64 * 1024;
const MAX_INBOX_RESPONSE_CHARS = Math.ceil(MAX_RELAY_BLOB_BYTES / 3) * 4 + 256;
const RECIPIENT_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export interface RelayReceipt {
  blobId: string;
  expiresAt: number;
}

export interface RelayInboxItem {
  blobId: string;
  encryptedEnvelope: string;
}

export interface RelayTransport {
  httpGet(url: string, headers?: string, timeoutMs?: number): Promise<RelayHttpResponse>;
  httpPut(
    url: string,
    body: string,
    headers?: string,
    timeoutMs?: number,
  ): Promise<RelayHttpResponse>;
  httpPost(
    url: string,
    body: string,
    headers?: string,
    timeoutMs?: number,
  ): Promise<RelayHttpResponse>;
}

interface RelayHttpResponse {
  statusCode: number;
  body: string;
}

interface RelayReceiptResponse {
  blob_id: string;
  expires_at: number;
}

interface RelayInboxItemResponse {
  blob_id: string;
  payload_base64: string;
}

/**
 * Tor transport for already encrypted message envelopes.
 *
 * This class deliberately does not encrypt or decrypt data. Callers must pass
 * an opaque, already encrypted envelope (for example, a Signal ciphertext or
 * a payment HPKE envelope). Plaintext and encryption keys do not belong on
 * this relay protocol.
 */
export class RelayClient {
  private readonly baseUrl: string;

  constructor(
    relayUrl: string,
    private readonly transport: RelayTransport = TorManager.getInstance(),
    private readonly maxTtlSeconds = DEFAULT_MAX_TTL_SECONDS,
  ) {
    const parsed = new URL(relayUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || !isOnionUrl(relayUrl)) {
      throw new Error('RelayClient requires an HTTP(S) onion-service URL.');
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !['', '/'].includes(parsed.pathname)
    ) {
      throw new Error('RelayClient URL must contain only the onion-service origin.');
    }
    if (!Number.isSafeInteger(maxTtlSeconds) || maxTtlSeconds < 1) {
      throw new Error('RelayClient maximum TTL must be a positive safe integer.');
    }
    this.baseUrl = parsed.origin;
  }

  async enqueue(
    recipientOnionHash: string,
    encryptedEnvelope: string,
    ttlSeconds: number,
  ): Promise<RelayReceipt> {
    const recipientHash = validateRecipientHash(recipientOnionHash);
    if (typeof encryptedEnvelope !== 'string' || encryptedEnvelope.length === 0) {
      throw new Error('RelayClient requires a non-empty encrypted envelope.');
    }
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > this.maxTtlSeconds) {
      throw new Error(`RelayClient TTL must be between 1 and ${this.maxTtlSeconds} seconds.`);
    }

    const response = await this.transport.httpPut(
      `${this.baseUrl}/blob/${recipientHash}`,
      encryptedEnvelope,
      JSON.stringify({
        'Content-Type': 'application/octet-stream',
        'X-Expiry': String(ttlSeconds),
      }),
    );
    if (response.statusCode !== 202) {
      throw new Error(`RelayClient enqueue failed with HTTP ${response.statusCode}.`);
    }

    let parsedReceipt: unknown;
    try {
      parsedReceipt = JSON.parse(response.body);
    } catch {
      throw new Error('RelayClient received an invalid enqueue receipt.');
    }
    if (typeof parsedReceipt !== 'object' || parsedReceipt === null) {
      throw new Error('RelayClient received an invalid enqueue receipt.');
    }
    const receipt = parsedReceipt as RelayReceiptResponse;
    if (
      !isUuid(receipt.blob_id) ||
      !Number.isSafeInteger(receipt.expires_at) ||
      receipt.expires_at <= 0
    ) {
      throw new Error('RelayClient received an invalid enqueue receipt.');
    }

    return { blobId: receipt.blob_id, expiresAt: receipt.expires_at };
  }

  async receiveNext(recipientOnionHash: string): Promise<RelayInboxItem | null> {
    const recipientHash = validateRecipientHash(recipientOnionHash);
    const response = await this.transport.httpGet(
      `${this.baseUrl}/inbox/${recipientHash}`,
    );
    if (response.statusCode === 204) return null;
    if (response.statusCode !== 200) {
      throw new Error(`RelayClient inbox request failed with HTTP ${response.statusCode}.`);
    }
    if (response.body.length > MAX_INBOX_RESPONSE_CHARS) {
      throw new Error('RelayClient inbox item exceeds the configured size limit.');
    }

    let parsedItem: unknown;
    try {
      parsedItem = JSON.parse(response.body);
    } catch {
      throw new Error('RelayClient received an invalid inbox item.');
    }
    if (typeof parsedItem !== 'object' || parsedItem === null) {
      throw new Error('RelayClient received an invalid inbox item.');
    }
    const item = parsedItem as RelayInboxItemResponse;
    if (!isUuid(item.blob_id) || typeof item.payload_base64 !== 'string') {
      throw new Error('RelayClient received an invalid inbox item.');
    }

    let encryptedEnvelope: string;
    try {
      encryptedEnvelope = new TextDecoder('utf-8', { fatal: true }).decode(
        decodeBase64(item.payload_base64),
      );
    } catch {
      throw new Error('RelayClient received an invalid inbox payload.');
    }
    if (encryptedEnvelope.length === 0) {
      throw new Error('RelayClient received an empty inbox payload.');
    }
    return { blobId: item.blob_id, encryptedEnvelope };
  }

  /** Removes a queued blob only after the caller has durably handled it. */
  async acknowledge(recipientOnionHash: string, blobId: string): Promise<void> {
    const recipientHash = validateRecipientHash(recipientOnionHash);
    if (!isUuid(blobId)) throw new Error('RelayClient blob ID must be a UUID.');

    const response = await this.transport.httpPost(
      `${this.baseUrl}/inbox/${recipientHash}/ack/${blobId}`,
      '',
    );
    if (response.statusCode !== 204) {
      throw new Error(`RelayClient inbox acknowledgement failed with HTTP ${response.statusCode}.`);
    }
  }
}

function validateRecipientHash(value: string): string {
  if (!RECIPIENT_HASH_PATTERN.test(value)) {
    throw new Error('RelayClient recipient hash must be 64 hexadecimal characters.');
  }
  return value.toLowerCase();
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function decodeBase64(encoded: string): Uint8Array {
  if (encoded.length > Math.ceil(MAX_RELAY_BLOB_BYTES / 3) * 4) {
    throw new Error('Relay blob exceeds the configured size limit.');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('Invalid base64 payload.');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const outputLength = (encoded.length / 4) * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  const decoded = new Uint8Array(outputLength);
  let outputIndex = 0;
  for (let index = 0; index < encoded.length; index += 4) {
    const first = alphabet.indexOf(encoded[index]);
    const second = alphabet.indexOf(encoded[index + 1]);
    const third = encoded[index + 2] === '=' ? 0 : alphabet.indexOf(encoded[index + 2]);
    const fourth = encoded[index + 3] === '=' ? 0 : alphabet.indexOf(encoded[index + 3]);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      throw new Error('Invalid base64 payload.');
    }
    if (outputIndex < outputLength) decoded[outputIndex++] = (first << 2) | (second >> 4);
    if (outputIndex < outputLength) decoded[outputIndex++] = ((second & 0x0f) << 4) | (third >> 2);
    if (outputIndex < outputLength) decoded[outputIndex++] = ((third & 0x03) << 6) | fourth;
  }
  if (decoded.length > MAX_RELAY_BLOB_BYTES) {
    throw new Error('Relay blob exceeds the configured size limit.');
  }
  return decoded;
}
