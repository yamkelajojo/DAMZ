import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const spec = await readFile(new URL('../services/relay/SPEC.md', import.meta.url), 'utf8');
const source = await readFile(new URL('../services/relay/src/main.rs', import.meta.url), 'utf8');
const client = await readFile(new URL('../packages/core/src/relay/RelayClient.ts', import.meta.url), 'utf8');
const receiver = await readFile(
  new URL('../packages/core/src/payments/PaymentNotificationReceiver.ts', import.meta.url),
  'utf8',
);
const tor = await readFile(new URL('../packages/core/src/tor/TorManager.ts', import.meta.url), 'utf8');

for (const required of [
  'GET /inbox/{recipient_onion_hash}',
  'POST /inbox/{recipient_onion_hash}/ack/{blob_id}',
  '204 No Content',
  'MAX_BLOBS_PER_RECIPIENT',
  'MAX_TOTAL_BYTES',
  'MAX_TTL_SECONDS',
  'MAX_BLOB_SIZE',
  'recipient hash is an address, not a secret',
  'redelivers until acknowledgement',
]) {
  assert.ok(spec.includes(required), `relay specification must document: ${required}`);
}

for (const required of [
  '.route("/blob/:blob_ref", get(retrieve_blob).put(store_blob))',
  '.route("/inbox/:recipient_onion_hash", get(retrieve_next_for_recipient))',
  'DEFAULT_MAX_BLOBS_PER_RECIPIENT: usize = 1_000',
  'DEFAULT_MAX_TOTAL_BYTES: usize = 256 * 1024 * 1024',
  'DEFAULT_MAX_TTL_SECONDS: u64 = 7 * 24 * 60 * 60',
  'DefaultBodyLimit::max(max_blob_size)',
  'fn peek_next_for_recipient',
  'fn acknowledge(&mut self, recipient_hash: &str, blob_id: &Uuid)',
  'payload_base64: BASE64_STANDARD.encode(data)',
  'fn remove_expired',
]) {
  assert.ok(source.includes(required), `relay implementation must contain: ${required}`);
}
assert.match(
  source,
  /\.route\(\s*"\/inbox\/:recipient_onion_hash\/ack\/:blob_id"\s*,\s*post\(acknowledge_blob\)\s*,?\s*\)/,
  'relay implementation must register the inbox acknowledgement route',
);

for (const required of [
  '`${this.baseUrl}/blob/${recipientHash}`',
  '`${this.baseUrl}/inbox/${recipientHash}`',
  '`${this.baseUrl}/inbox/${recipientHash}/ack/${blobId}`',
  'response.statusCode !== 202',
  'response.statusCode === 204',
  'async acknowledge(',
  'payload_base64',
  'isOnionUrl(relayUrl)',
  'opaque, already encrypted envelope',
]) {
  assert.ok(client.includes(required), `mobile relay client must contain: ${required}`);
}
assert.ok(tor.includes('async httpPut('), 'TorManager must expose native PUT for relay uploads');
assert.ok(tor.includes('async httpPost('), 'TorManager must expose native POST for relay acknowledgements');
const durableCommitIndex = receiver.indexOf('await replayStore.recordIfNew(notification)');
const relayAcknowledgementIndex = receiver.indexOf(
  'await relay.acknowledge(recipientOnionHash, item.blobId)',
);
assert.ok(
  durableCommitIndex >= 0 && relayAcknowledgementIndex > durableCommitIndex,
  'the payment receiver must persist an authenticated event before acknowledging the relay item',
);

console.log('relay protocol, mobile client, and implementation contract verified');
