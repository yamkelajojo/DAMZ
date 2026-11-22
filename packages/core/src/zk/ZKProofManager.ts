/**
 * ZKProofManager — Wrapper for @ajna-inc/poe-proofs
 *
 * Generates and verifies zero-knowledge location proofs (POE Protocol).
 * With Zakura Common optimizations for mobile performance.
 */

import {
  generateLocationProofPOE,
  verifyLocationProofPOE,
  LocationProofInputNew,
  MagneticField,
} from '@ajna-inc/poe-proofs';

export interface LocationProofSensorSample {
  /** Altitude in metres, as measured by the device. */
  altitudeM: number;
  /** Horizontal GPS accuracy in metres. */
  gpsAccuracyM: number;
  /** Magnetic field vector in microtesla, as measured by the magnetometer. */
  magneticFieldUt: { x: number; y: number; z: number };
  /** Barometric pressure in pascals. */
  pressurePa: number;
}

export interface LocationProofInput {
  coordinates: { latitude: number; longitude: number };
  deliveryGeohash: string;
  radiusMeters: number;
  /**
   * Measured sensor data.
   *
   * Required: a location proof must attest to data the device actually
   * observed. These values used to be defaulted to constants (zero magnetic
   * field, 101325 Pa, zero altitude), which silently produced proofs for
   * conditions that were never measured.
   */
  sensor: LocationProofSensorSample;
  /** Caller-supplied domain separation / replay protection. */
  contextHash: number;
  /** Caller-supplied session identifier. */
  sessionId: number;
}

export interface LocationProofOutput {
  isValid: boolean;
  confidenceScore: number;
  proof: string;
  publicInputs: string[];
  vkHash: string;
  magneticValid: boolean;
  altitudeValid: boolean;
  gpsAccuracyOk: boolean;
  timestampFresh: boolean;
  expectedMagnetic: MagneticField;
}

/** Base-32 alphabet of the geohash encoding (`a`, `i`, `l` and `o` are unused). */
const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Longest geohash precision considered by {@link requiredGeohashPrefixLength}. */
const MAX_GEOHASH_PRECISION = 12;

/** Metres per degree of latitude, and per degree of longitude at the equator. */
const METRES_PER_DEGREE = 111_320;

/**
 * Smallest number of leading geohash characters that guarantees two points in
 * the *same* cell are no further apart than `radiusMeters`.
 *
 * A `p`-character geohash interleaves `5p` bits: longitude takes the odd bits,
 * latitude the even ones, so a cell spans `360 / 2^ceil(5p/2)` degrees of
 * longitude and `180 / 2^floor(5p/2)` degrees of latitude. Requiring the cell
 * *diagonal* to fit inside the radius makes a prefix comparison sound — equal
 * prefixes mean the same cell, which means a distance below the radius. The
 * longitude span is evaluated at the equator (its widest) so the bound holds at
 * every latitude.
 *
 * Returns `null` when even the maximum precision cannot resolve the radius.
 */
function requiredGeohashPrefixLength(radiusMeters: number): number | null {
  for (let precision = 1; precision <= MAX_GEOHASH_PRECISION; precision += 1) {
    const bits = 5 * precision;
    const longitudeBits = Math.ceil(bits / 2);
    const latitudeBits = bits - longitudeBits;

    const widthMeters = (360 / 2 ** longitudeBits) * METRES_PER_DEGREE;
    const heightMeters = (180 / 2 ** latitudeBits) * METRES_PER_DEGREE;

    if (Math.hypot(widthMeters, heightMeters) <= radiusMeters) {
      return precision;
    }
  }

  return null;
}

/**
 * Validate and normalise a geohash string.
 *
 * Rejects characters outside the geohash alphabet: a malformed geohash would
 * otherwise be compared as an opaque string and could match by accident.
 */
function normalizeGeohash(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`verifyCoarseGeohash: ${label} must be a non-empty geohash string`);
  }

  const geohash = value.trim().toLowerCase();
  for (const character of geohash) {
    if (!GEOHASH_ALPHABET.includes(character)) {
      throw new Error(
        `verifyCoarseGeohash: ${label} is not a valid geohash (unexpected character "${character}")`
      );
    }
  }

  return geohash;
}

export class ZKProofManager {
  private static instance: ZKProofManager;

  private constructor() {}

  static getInstance(): ZKProofManager {
    if (!ZKProofManager.instance) {
      ZKProofManager.instance = new ZKProofManager();
    }
    return ZKProofManager.instance;
  }

  async generateLocationProof(input: LocationProofInput): Promise<LocationProofOutput> {
    const { sensor } = input;

    if (
      !sensor ||
      typeof sensor.altitudeM !== 'number' ||
      typeof sensor.gpsAccuracyM !== 'number' ||
      typeof sensor.pressurePa !== 'number' ||
      typeof sensor.magneticFieldUt?.x !== 'number' ||
      typeof sensor.magneticFieldUt?.y !== 'number' ||
      typeof sensor.magneticFieldUt?.z !== 'number'
    ) {
      throw new Error(
        'generateLocationProof: measured sensor data is required ' +
          '(sensor.altitudeM, sensor.gpsAccuracyM, sensor.pressurePa, ' +
          'sensor.magneticFieldUt.{x,y,z}). A proof must never be generated ' +
          'from fabricated defaults.'
      );
    }

    try {
      const now = Math.floor(Date.now() / 1000);

      const poeInput: LocationProofInputNew = {
        nonce: Date.now(),
        contextHash: input.contextHash,
        sessionId: input.sessionId,
        latitude: input.coordinates.latitude,
        longitude: input.coordinates.longitude,
        altitudeM: sensor.altitudeM,
        gpsAccuracyM: sensor.gpsAccuracyM,
        magXUt: sensor.magneticFieldUt.x,
        magYUt: sensor.magneticFieldUt.y,
        magZUt: sensor.magneticFieldUt.z,
        pressurePa: sensor.pressurePa,
        proofTimestamp: now,
        currentTimestamp: now,
        magneticTolerancePercent: 30,
        altitudeToleranceM: 50,
      };

      const result = await generateLocationProofPOE(poeInput);

      return {
        isValid: result.isValid,
        confidenceScore: result.confidenceScore,
        proof: result.proofJson,
        publicInputs: result.publicInputs,
        vkHash: '', // Not provided by the POE API
        magneticValid: result.magneticValid,
        altitudeValid: result.altitudeValid,
        gpsAccuracyOk: result.gpsAccuracyOk,
        timestampFresh: result.timestampFresh,
        expectedMagnetic: result.expectedMagnetic,
      };
    } catch (error) {
      throw new Error(`Failed to generate location proof: ${error}`);
    }
  }

  async verifyLocationProof(proof: string, publicInputs: string[]): Promise<boolean> {
    try {
      return await verifyLocationProofPOE(proof, publicInputs);
    } catch (error) {
      throw new Error(`Failed to verify location proof: ${error}`);
    }
  }

  /**
   * Coarse, explicitly non-ZK radius check used only when ZK proving is
   * unavailable (ADR-0027/0030). Two geohashes match when they share enough
   * leading characters that the shared cell fits inside the radius.
   *
   * This is a *prefix* test, not a distance measurement: it is deliberately
   * conservative (it can reject a pair that is genuinely within the radius, near
   * a cell boundary) because accepting an out-of-radius runner is the failure
   * that matters. Callers must record that this check is non-ZK.
   *
   * The previous implementation derived the prefix length from
   * `log2(radiusMeters / 1000)`, which yielded a *single* character — a cell
   * roughly 5000 km across — for every radius below ~2 km, so it accepted any
   * two points in southern Africa as "within 100 metres".
   */
  async verifyCoarseGeohash(
    runnerGeohash: string,
    deliveryGeohash: string,
    radiusMeters: number
  ): Promise<boolean> {
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      throw new Error(
        `verifyCoarseGeohash: radiusMeters must be a positive number (received ${radiusMeters})`
      );
    }

    const precision = requiredGeohashPrefixLength(radiusMeters);
    if (precision === null) {
      throw new Error(
        `verifyCoarseGeohash: a ${radiusMeters} m radius is below the resolution of a ` +
          `${MAX_GEOHASH_PRECISION}-character geohash. Use the ZK location proof instead of ` +
          'the coarse fallback.'
      );
    }

    const runner = normalizeGeohash(runnerGeohash, 'runnerGeohash');
    const delivery = normalizeGeohash(deliveryGeohash, 'deliveryGeohash');

    if (runner.length < precision || delivery.length < precision) {
      throw new Error(
        `verifyCoarseGeohash: a ${radiusMeters} m radius needs ${precision} geohash ` +
          `characters, but the inputs have ${runner.length} and ${delivery.length}. ` +
          'Refusing to compare at a coarser precision than the radius allows.'
      );
    }

    return runner.slice(0, precision) === delivery.slice(0, precision);
  }

  // Helper to create input from measured sensor data
  static createProofInput(params: {
    latitude: number;
    longitude: number;
    deliveryGeohash: string;
    radiusMeters: number;
    sensor: LocationProofSensorSample;
    contextHash: number;
    sessionId: number;
  }): LocationProofInput {
    return {
      coordinates: { latitude: params.latitude, longitude: params.longitude },
      deliveryGeohash: params.deliveryGeohash,
      radiusMeters: params.radiusMeters,
      sensor: params.sensor,
      contextHash: params.contextHash,
      sessionId: params.sessionId,
    };
  }
}
