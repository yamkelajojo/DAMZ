import { RelayClient, type RelayTransport } from '../relay/RelayClient';

const RELAY_URL = `http://${'a'.repeat(56)}.onion`;
const RECIPIENT_HASH = 'A'.repeat(64);
const CIPHERTEXT = 'opaque-signal-ciphertext-envelope';
const RECEIPT_ID = 'ce9dcece-61de-4a94-95f2-b7c48d8dd2dc';
const RECEIVED_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('RelayClient', () => {
  let transport: jest.Mocked<RelayTransport>;

  beforeEach(() => {
    transport = {
      httpGet: jest.fn(),
      httpPut: jest.fn(),
      httpPost: jest.fn(),
    };
  });

  it('queues an encrypted envelope by normalized recipient hash', async () => {
    transport.httpPut.mockResolvedValue({
      statusCode: 202,
      body: JSON.stringify({ blob_id: RECEIPT_ID, expires_at: 1_800_000_000 }),
    });
    const relay = new RelayClient(RELAY_URL, transport);

    await expect(relay.enqueue(RECIPIENT_HASH, CIPHERTEXT, 86_400)).resolves.toEqual({
      blobId: RECEIPT_ID,
      expiresAt: 1_800_000_000,
    });
    expect(transport.httpPut).toHaveBeenCalledWith(
      `http://${'a'.repeat(56)}.onion/blob/${RECIPIENT_HASH.toLowerCase()}`,
      CIPHERTEXT,
      JSON.stringify({
        'Content-Type': 'application/octet-stream',
        'X-Expiry': '86400',
      }),
    );
  });

  it('receives a stable inbox item until the caller acknowledges it', async () => {
    transport.httpGet
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          blob_id: RECEIVED_ID,
          payload_base64: Buffer.from(CIPHERTEXT, 'utf8').toString('base64'),
        }),
      })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });
    transport.httpPost.mockResolvedValueOnce({ statusCode: 204, body: '' });
    const relay = new RelayClient(RELAY_URL, transport);

    await expect(relay.receiveNext(RECIPIENT_HASH)).resolves.toEqual({
      blobId: RECEIVED_ID,
      encryptedEnvelope: CIPHERTEXT,
    });
    await expect(relay.acknowledge(RECIPIENT_HASH, RECEIVED_ID)).resolves.toBeUndefined();
    await expect(relay.receiveNext(RECIPIENT_HASH)).resolves.toBeNull();
    expect(transport.httpGet).toHaveBeenCalledWith(
      `http://${'a'.repeat(56)}.onion/inbox/${RECIPIENT_HASH.toLowerCase()}`,
    );
    expect(transport.httpPost).toHaveBeenCalledWith(
      `http://${'a'.repeat(56)}.onion/inbox/${RECIPIENT_HASH.toLowerCase()}/ack/${RECEIVED_ID}`,
      '',
    );
  });

  it('rejects clear-net relay URLs and invalid recipient hashes before sending', async () => {
    expect(() => new RelayClient('https://relay.example.com', transport)).toThrow(
      /onion-service/,
    );
    const relay = new RelayClient(RELAY_URL, transport);

    await expect(relay.enqueue('invalid', CIPHERTEXT, 60)).rejects.toThrow(/64 hexadecimal/);
    await expect(relay.receiveNext('invalid')).rejects.toThrow(/64 hexadecimal/);
    await expect(relay.acknowledge(RECIPIENT_HASH, 'invalid')).rejects.toThrow(/UUID/);
    expect(transport.httpPut).not.toHaveBeenCalled();
    expect(transport.httpGet).not.toHaveBeenCalled();
    expect(transport.httpPost).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads, TTLs, and malformed relay receipts', async () => {
    const relay = new RelayClient(RELAY_URL, transport);
    await expect(relay.enqueue(RECIPIENT_HASH, '', 60)).rejects.toThrow(/non-empty/);
    await expect(relay.enqueue(RECIPIENT_HASH, CIPHERTEXT, 0)).rejects.toThrow(/TTL/);

    transport.httpPut.mockResolvedValueOnce({ statusCode: 202, body: '{"blob_id":"bad"}' });
    await expect(relay.enqueue(RECIPIENT_HASH, CIPHERTEXT, 60)).rejects.toThrow(
      /invalid enqueue receipt/,
    );
  });

  it('rejects malformed inbox payloads without exposing them to callers', async () => {
    transport.httpGet.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ blob_id: RECEIVED_ID, payload_base64: 'not base64' }),
    });
    const relay = new RelayClient(RELAY_URL, transport);

    await expect(relay.receiveNext(RECIPIENT_HASH)).rejects.toThrow(/invalid inbox payload/);
  });

  it('surfaces non-success HTTP responses without exposing response bodies', async () => {
    transport.httpPut.mockResolvedValueOnce({ statusCode: 503, body: 'private relay detail' });
    transport.httpGet.mockResolvedValueOnce({ statusCode: 500, body: 'private relay detail' });
    transport.httpPost.mockResolvedValueOnce({ statusCode: 500, body: 'private relay detail' });
    const relay = new RelayClient(RELAY_URL, transport);

    await expect(relay.enqueue(RECIPIENT_HASH, CIPHERTEXT, 60)).rejects.toThrow('HTTP 503');
    await expect(relay.receiveNext(RECIPIENT_HASH)).rejects.toThrow('HTTP 500');
    await expect(relay.acknowledge(RECIPIENT_HASH, RECEIVED_ID)).rejects.toThrow('HTTP 500');
  });
});
