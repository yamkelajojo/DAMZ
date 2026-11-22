import { Point } from '@noble/ed25519';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  Aes256Gcm,
  CipherSuite,
  HkdfSha256,
} from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import * as base58btc from 'base58-universal';

const ENVELOPE_VERSION = 1;
const INFO_PREFIX = 'DAMZ/relay/payment-notification/v1';
export const MAX_PAYMENT_NOTIFICATION_BYTES = 64 * 1024;
const ED25519_PUBLIC_HEADER = [0xed, 0x01];
const ED25519_PRIVATE_HEADER = [0x80, 0x26];

export interface PaymentConfirmedNotification {
  type: 'payment.confirmed';
  eventId: string;
  issuedAt: number;
  orderId: string;
  subaddress: string;
  txid: string;
  amountPiconero: string;
  confirmations: number;
}

export interface HpkeEnvelope {
  version: 1;
  enc: string;
  ciphertext: string;
}

/**
 * Encrypts and authenticates a payment event from Gateway DID to Runner DID.
 * The private Ed25519 DID keys are converted to the DID's derived X25519
 * agreement keys; no key material crosses the relay.
 */
export async function sealPaymentNotification(
  notification: PaymentConfirmedNotification,
  gatewayDid: string,
  gatewayEd25519PrivateKeyMultibase: string,
  runnerDid: string,
): Promise<string> {
  validateNotification(notification);
  const suite = createSuite();
  const recipientPublicKey = await suite.kem.deserializePublicKey(
    ed25519DidToX25519PublicKey(runnerDid),
  );
  const senderKeys = await deriveX25519KeyPair(
    gatewayDid,
    gatewayEd25519PrivateKeyMultibase,
  );

  const context = await suite.createSenderContext({
    recipientPublicKey,
    senderKey: senderKeys,
    info: contextInfo(gatewayDid, runnerDid),
  });
  const plaintext = new TextEncoder().encode(JSON.stringify(notification));
  const aad = additionalData(gatewayDid, runnerDid);
  const ciphertext = await context.seal(plaintext, aad);
  const envelope: HpkeEnvelope = {
    version: ENVELOPE_VERSION,
    enc: encodeBase64(new Uint8Array(context.enc)),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
  };
  const serialized = JSON.stringify(envelope);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYMENT_NOTIFICATION_BYTES) {
    throw new Error('Payment notification envelope exceeds the relay size limit.');
  }
  return serialized;
}

/** Decrypts an HPKE Auth envelope and verifies it came from the pinned DID. */
export async function openPaymentNotification(
  serializedEnvelope: string,
  expectedGatewayDid: string,
  runnerDid: string,
  runnerEd25519PrivateKeyMultibase: string,
): Promise<PaymentConfirmedNotification> {
  if (new TextEncoder().encode(serializedEnvelope).byteLength > MAX_PAYMENT_NOTIFICATION_BYTES) {
    throw new Error('Payment notification envelope exceeds the relay size limit.');
  }
  const envelope = parseEnvelope(serializedEnvelope);
  const suite = createSuite();
  const runnerKeys = await deriveX25519KeyPair(
    runnerDid,
    runnerEd25519PrivateKeyMultibase,
  );
  const gatewayPublicKey = await suite.kem.deserializePublicKey(
    ed25519DidToX25519PublicKey(expectedGatewayDid),
  );
  const context = await suite.createRecipientContext({
    recipientKey: runnerKeys.privateKey,
    senderPublicKey: gatewayPublicKey,
    enc: decodeBase64(envelope.enc),
    info: contextInfo(expectedGatewayDid, runnerDid),
  });
  const plaintext = await context.open(
    decodeBase64(envelope.ciphertext),
    additionalData(expectedGatewayDid, runnerDid),
  );

  let notification: unknown;
  try {
    notification = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Payment notification payload is not valid JSON.');
  }
  validateNotification(notification);
  return notification;
}

function createSuite(): CipherSuite {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'WebCrypto is unavailable. Install the Runner native crypto bootstrap before using payment notifications.',
    );
  }
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function deriveX25519KeyPair(
  ed25519Did: string,
  ed25519PrivateKeyMultibase: string,
): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  const ed25519PublicKeyMultibase = publicMultibaseFromDid(ed25519Did);
  const ed25519PublicBytes = decodeMultibaseKey(
    ed25519PublicKeyMultibase,
    ED25519_PUBLIC_HEADER,
  );
  const ed25519PrivateBytes = decodeMultibaseKey(
    ed25519PrivateKeyMultibase,
    ED25519_PRIVATE_HEADER,
  );
  if (
    ed25519PublicBytes.length !== 32 ||
    ![32, 64].includes(ed25519PrivateBytes.length)
  ) {
    throw new Error('DID key material has an invalid length.');
  }
  if (
    ed25519PrivateBytes.length === 64 &&
    !equalBytes(ed25519PrivateBytes.subarray(32), ed25519PublicBytes)
  ) {
    throw new Error('DID private key does not contain the DID public key.');
  }

  // Digital Bazaar's Ed25519VerificationKey2020 format contains the 32-byte
  // seed (and commonly its 32-byte public key suffix). Its X25519 conversion
  // is clamp(SHA-512(seed)[0..32]); derive that value with WebCrypto so this
  // module does not pull Node's `crypto` module into the React Native bundle.
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      'SHA-512',
      toArrayBuffer(ed25519PrivateBytes.subarray(0, 32)),
    ),
  );
  const privateKeyBytes = digest.slice(0, 32);
  privateKeyBytes[0] &= 248;
  privateKeyBytes[31] &= 127;
  privateKeyBytes[31] |= 64;
  const expectedPublicKeyBytes = Point.fromHex(ed25519PublicBytes).toX25519();
  const publicKeyBytes = x25519.getPublicKey(privateKeyBytes);
  if (publicKeyBytes.length !== 32) {
    throw new Error('DID public key could not be converted to X25519.');
  }
  if (!equalBytes(publicKeyBytes, expectedPublicKeyBytes)) {
    throw new Error('DID public and private key-agreement material do not match.');
  }

  const suite = createSuite();
  const publicKey = await suite.kem.deserializePublicKey(publicKeyBytes);
  const privateKey = await suite.kem.deserializePrivateKey(privateKeyBytes);
  return { publicKey, privateKey };
}

function publicMultibaseFromDid(did: string): string {
  const prefix = 'did:key:';
  const publicKey = did.startsWith(prefix) ? did.slice(prefix.length) : '';
  decodeMultibaseKey(publicKey, ED25519_PUBLIC_HEADER);
  return publicKey;
}

function ed25519DidToX25519PublicKey(did: string): Uint8Array {
  const ed25519PublicKeyMultibase = publicMultibaseFromDid(did);
  const ed25519PublicKeyBytes = decodeMultibaseKey(
    ed25519PublicKeyMultibase,
    ED25519_PUBLIC_HEADER,
  );
  const x25519PublicKeyBytes = Point.fromHex(ed25519PublicKeyBytes).toX25519();
  if (x25519PublicKeyBytes.length !== 32) {
    throw new Error('DID public key could not be converted to X25519.');
  }
  return x25519PublicKeyBytes;
}

function decodeMultibaseKey(value: string, expectedHeader: number[]): Uint8Array {
  if (!value.startsWith('z')) throw new Error('Expected base58btc multibase key material.');
  let decoded: Uint8Array;
  try {
    decoded = base58btc.decode(value.slice(1));
  } catch {
    throw new Error('DID key material is not valid base58btc.');
  }
  if (
    decoded.length < expectedHeader.length ||
    !expectedHeader.every((byte, index) => decoded[index] === byte)
  ) {
    throw new Error('DID key material has an unexpected multicodec header.');
  }
  return decoded.subarray(expectedHeader.length);
}

function contextInfo(gatewayDid: string, runnerDid: string): Uint8Array {
  return new TextEncoder().encode(`${INFO_PREFIX}\0${gatewayDid}\0${runnerDid}`);
}

function additionalData(gatewayDid: string, runnerDid: string): Uint8Array {
  return new TextEncoder().encode(`gateway=${gatewayDid}\nrunner=${runnerDid}`);
}

function parseEnvelope(value: string): HpkeEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Payment notification envelope is not valid JSON.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as HpkeEnvelope).version !== ENVELOPE_VERSION ||
    typeof (parsed as HpkeEnvelope).enc !== 'string' ||
    typeof (parsed as HpkeEnvelope).ciphertext !== 'string'
  ) {
    throw new Error('Payment notification envelope has an unsupported format.');
  }
  return parsed as HpkeEnvelope;
}

function validateNotification(value: unknown): asserts value is PaymentConfirmedNotification {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Payment notification payload has an invalid format.');
  }
  const notification = value as Partial<PaymentConfirmedNotification>;
  if (
    notification.type !== 'payment.confirmed' ||
    typeof notification.eventId !== 'string' ||
    !isUuid(notification.eventId) ||
    !Number.isSafeInteger(notification.issuedAt) ||
    (notification.issuedAt ?? 0) <= 0 ||
    typeof notification.orderId !== 'string' ||
    notification.orderId.length === 0 ||
    typeof notification.subaddress !== 'string' ||
    notification.subaddress.length === 0 ||
    typeof notification.txid !== 'string' ||
    notification.txid.length === 0 ||
    typeof notification.amountPiconero !== 'string' ||
    !/^\d+$/.test(notification.amountPiconero) ||
    !Number.isSafeInteger(notification.confirmations) ||
    (notification.confirmations ?? 0) < 3
  ) {
    throw new Error('Payment notification payload is invalid.');
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const first = bytes[index];
    const second = remaining > 1 ? bytes[index + 1] : 0;
    const third = remaining > 2 ? bytes[index + 2] : 0;
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 0x03) << 4) | (second >> 4)];
    encoded += remaining > 1 ? alphabet[((second & 0x0f) << 2) | (third >> 6)] : '=';
    encoded += remaining > 2 ? alphabet[third & 0x3f] : '=';
  }
  return encoded;
}

function decodeBase64(encoded: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('Payment notification contains invalid base64.');
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
      throw new Error('Payment notification contains invalid base64.');
    }
    if (outputIndex < outputLength) decoded[outputIndex++] = (first << 2) | (second >> 4);
    if (outputIndex < outputLength) decoded[outputIndex++] = ((second & 0x0f) << 4) | (third >> 2);
    if (outputIndex < outputLength) decoded[outputIndex++] = ((third & 0x03) << 6) | fourth;
  }
  return decoded;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}
