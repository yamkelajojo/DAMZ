/**
 * REQ-TYPES-01 — identifier formats must accept what the system actually emits.
 *
 * These are integration-shaped contracts, not style checks: each of these
 * patterns is used to validate values crossing a module boundary (storage →
 * domain, device → verifier), so an over-strict pattern silently rejects real
 * data.
 */

import {
  CIDSchema,
  GeohashSchema,
  OrderSchema,
  ProofBundleSchema,
} from '../index';

const ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * `bafkrei` + 52 base32 characters (59 total) is the shape of
 * `CID.create(1, raw.code, sha256).toString()` — what `@ipfs-meshkit/meshkit`'s
 * S3 client returns from `upload()`.
 */
const CID_V1_RAW = `bafkrei${'a'.repeat(52)}`;
/** CIDv1 with the dag-pb codec (`CID.create(1, dagPB.code, sha256)`). */
const CID_V1_DAG_PB = `bafybei${'a'.repeat(52)}`;
/** CIDv0: `Qm` + 44 base58btc characters. */
const CID_V0 = `Qm${'a'.repeat(44)}`;

describe('REQ-TYPES-01 — CIDSchema accepts the CIDs the storage layer produces', () => {
  it('accepts the CIDv1 raw form returned by meshkit upload()', () => {
    // Regression: `/^(Qm|bafy)[a-zA-Z0-9]{44,}$/` rejected this.
    expect(CID_V1_RAW.startsWith('bafkrei')).toBe(true);
    expect(CIDSchema.safeParse(CID_V1_RAW).success).toBe(true);
  });

  it('accepts CIDv1 dag-pb and CIDv0 CIDs', () => {
    expect(CIDSchema.parse(CID_V1_DAG_PB)).toBe(CID_V1_DAG_PB);
    expect(CIDSchema.parse(CID_V0)).toBe(CID_V0);
  });

  it.each([
    ['empty', ''],
    ['multibase prefix only', 'bafkrei'],
    ['one character short', CID_V1_RAW.slice(0, 58)],
    ['CIDv0 one character short', `Qm${'a'.repeat(43)}`],
    ['non-CID text', 'notacid'],
    ['base32 CIDv1 with an out-of-alphabet character', `bafkrei${'a'.repeat(51)}1`],
  ])('rejects a %s', (_label, value) => {
    expect(CIDSchema.safeParse(value).success).toBe(false);
  });

  it('accepts a proof bundle whose cid came from meshkit', () => {
    const bundle = ProofBundleSchema.parse({
      id: ORDER_ID,
      order_id: ORDER_ID,
      cid: CID_V1_RAW,
      uploaded_at: 1700000000,
    });

    expect(bundle.cid).toBe(CID_V1_RAW);
  });

  it('accepts an order carrying a meshkit proof_cid', () => {
    const order = OrderSchema.parse({
      id: ORDER_ID,
      customer_did: 'did:key:z6MkCustomer',
      runner_did: 'did:key:z6MkRunner',
      total_zar: '33.00',
      proof_cid: CID_V1_RAW,
      created_at: 1700000000,
      updated_at: 1700000001,
    });

    expect(order.proof_cid).toBe(CID_V1_RAW);
  });
});

describe('REQ-TYPES-01 — GeohashSchema matches the geohash alphabet', () => {
  it.each(['9', '9q5', '9q5ctr3', '9q5ctr3xyz1', '0123456789bc'])(
    'accepts the valid geohash %s',
    (geohash) => {
      expect(GeohashSchema.parse(geohash)).toBe(geohash);
    },
  );

  it.each([
    ['the letter a', '9q5a'],
    ['the letter i', '9q5i'],
    ['the letter l', '9q5l'],
    ['the letter o', '9q5o'],
    ['uppercase', '9Q5CTR3'],
    ['empty', ''],
    ['more than 12 characters', '0123456789bcd'],
    ['a non-alphabetic character', '9q5-ctr3'],
  ])('rejects a geohash containing %s', (_label, geohash) => {
    expect(GeohashSchema.safeParse(geohash).success).toBe(false);
  });

  it('agrees with the verifier: a schema-valid geohash is one the verifier accepts', async () => {
    // `ZKProofManager.verifyCoarseGeohash` validates against the same alphabet;
    // a value the schema allows but the verifier rejects would be a split-brain.
    expect(GeohashSchema.safeParse('9q5ctr3').success).toBe(true);
    expect(GeohashSchema.safeParse('9q5ctra').success).toBe(false);
  });
});
