/**
 * Contract tests for "fail loud" behaviour.
 *
 * Unimplemented or unsafe operations must throw a descriptive error instead of
 * silently succeeding or returning fabricated data.
 */

import { generateLocationProofPOE } from '@ajna-inc/poe-proofs';
import { PhotoAttestation } from '../photo/PhotoAttestation';
import { IPFSStorage } from '../ipfs/IPFSStorage';
import { ZKProofManager } from '../zk/ZKProofManager';

const MEASURED_SENSOR = {
  altitudeM: 42.5,
  gpsAccuracyM: 6,
  pressurePa: 101_212,
  magneticFieldUt: { x: 21.4, y: -8.2, z: 43.7 },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ZKProofManager', () => {
  it('refuses to build a location proof without measured sensor data', async () => {
    const manager = ZKProofManager.getInstance();

    await expect(
      manager.generateLocationProof({
        coordinates: { latitude: 34.05, longitude: -118.24 },
        deliveryGeohash: '9q5',
        radiusMeters: 100,
        sensor: undefined as never,
        contextHash: 1234,
        sessionId: 7,
      })
    ).rejects.toThrow(/measured sensor data is required/);
  });

  it('passes measured sensor values through to the POE prover', async () => {
    const manager = ZKProofManager.getInstance();

    await manager.generateLocationProof({
      coordinates: { latitude: 34.05, longitude: -118.24 },
      deliveryGeohash: '9q5',
      radiusMeters: 100,
      sensor: MEASURED_SENSOR,
      contextHash: 1234,
      sessionId: 7,
    });

    expect(generateLocationProofPOE).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 34.05,
        longitude: -118.24,
        altitudeM: 42.5,
        gpsAccuracyM: 6,
        magXUt: 21.4,
        magYUt: -8.2,
        magZUt: 43.7,
        pressurePa: 101_212,
        contextHash: 1234,
        sessionId: 7,
      })
    );
  });
});

describe('ZKProofManager.verifyCoarseGeohash', () => {
  const manager = ZKProofManager.getInstance();

  it('rejects a non-positive radius instead of accepting everything', async () => {
    await expect(manager.verifyCoarseGeohash('9q5ctr3', '9q5ctr8', 0)).rejects.toThrow(
      /radiusMeters must be a positive number/
    );
    await expect(manager.verifyCoarseGeohash('9q5ctr3', '9q5ctr8', -1)).rejects.toThrow(
      /radiusMeters must be a positive number/
    );
    await expect(manager.verifyCoarseGeohash('9q5ctr3', '9q5ctr8', Number.NaN)).rejects.toThrow(
      /radiusMeters must be a positive number/
    );
  });

  it('rejects geohashes containing characters outside the geohash alphabet', async () => {
    await expect(manager.verifyCoarseGeohash('9q5ai', '9q5ctr8', 1500)).rejects.toThrow(
      /not a valid geohash/
    );
  });

  it('refuses to compare when the inputs are shorter than the radius requires', async () => {
    // A 1 km radius needs 7 characters, so a 3-character geohash cannot be
    // compared at the precision the radius demands.
    await expect(manager.verifyCoarseGeohash('9q5', '9q5', 1000)).rejects.toThrow(
      /needs 7 geohash characters/
    );
  });

  it('matches two geohashes inside the cell the radius requires', async () => {
    await expect(manager.verifyCoarseGeohash('9q5ctr3', '9q5ctr8', 1500)).resolves.toBe(true);
  });

  it('does not match geohashes that only share a coarser prefix', async () => {
    // Both begin with "9q5". The previous log2-based formula compared a single
    // character at this radius and returned true — accepting points thousands
    // of kilometres apart as "within 1.5 km".
    await expect(manager.verifyCoarseGeohash('9q5ctr3', '9q5dz12', 1500)).resolves.toBe(false);
  });

  it('tightens the required prefix as the radius shrinks', async () => {
    // 6 characters fit inside 1500 m; a 1 km radius needs 7, so the same pair
    // is accepted at the looser radius and rejected at the tighter one.
    await expect(manager.verifyCoarseGeohash('9q5ctr3', '9q5ctr8', 1500)).resolves.toBe(true);
    await expect(manager.verifyCoarseGeohash('9q5ctr3', '9q5ctr8', 1000)).resolves.toBe(false);
  });
});

describe('IPFSStorage', () => {
  it('throws instead of silently ignoring a delete request', async () => {
    const storage = IPFSStorage.getInstance();

    await expect(storage.delete('QmTest...')).rejects.toThrow(/not implemented/);
  });

  it('throws instead of silently ignoring an unpin request', async () => {
    const storage = IPFSStorage.getInstance();

    await expect(storage.unpin('QmTest...')).rejects.toThrow(/not implemented/);
  });
});

describe('PhotoAttestation', () => {
  it('requires a media path before signing', async () => {
    const attestation = PhotoAttestation.getInstance();

    await expect(
      attestation.captureAndSign({
        mediaPath: '',
        certChainPEM: 'test-cert-chain',
        capturerUuid: 'user-1',
      })
    ).rejects.toThrow(/mediaPath is required/);
  });

  it('requires a server-issued cert chain before signing', async () => {
    const attestation = PhotoAttestation.getInstance();

    await expect(
      attestation.captureAndSign({
        mediaPath: 'file://photo.jpg',
        certChainPEM: '',
        capturerUuid: 'user-1',
      })
    ).rejects.toThrow(/certChainPEM is required/);
  });

  it('does not pretend to verify attestations it cannot verify', async () => {
    const attestation = PhotoAttestation.getInstance();

    await expect(
      attestation.verifyAttestation('file://a.jpg', '{}', 'token')
    ).rejects.toThrow(/not implemented/);
  });
});
