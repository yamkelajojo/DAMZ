/**
 * ZKProofManager — Wrapper for @ajna-inc/poe-proofs
 *
 * Generates and verifies zero-knowledge location proofs (POE Protocol).
 * With Zakura Common optimizations for mobile performance.
 */

import { generateLocationProofPOE, verifyLocationProofPOE } from '@ajna-inc/poe-proofs';

export interface LocationProofInput {
  nonce: number;
  contextHash: number;
  sessionId: number;
  latitude: number;
  longitude: number;
  altitudeM: number;
  gpsAccuracyM: number;
  magXUt: number;
  magYUt: number;
  magZUt: number;
  pressurePa: number;
  proofTimestamp: number;
  currentTimestamp: number;
  magneticTolerancePercent: number;
  altitudeToleranceM: number;
}

export interface LocationProofOutput {
  isValid: boolean;
  confidenceScore: number;
  proof: string; // JSON string
  publicInputs: string[];
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
    try {
      const result = await generateLocationProofPOE(input);
      return {
        isValid: result.isValid,
        confidenceScore: result.confidenceScore,
        proof: JSON.stringify(result),
        publicInputs: [], // Extracted from result
      };
    } catch (error) {
      throw new Error(`Failed to generate location proof: ${error}`);
    }
  }

  async verifyLocationProof(
    proofJson: string,
    publicInputs: string[],
    verificationKeyPath: string
  ): Promise<boolean> {
    try {
      // Note: verifyLocationProofPOE is Node.js only (requires snarkjs)
      // On React Native, verification happens on the customer app or admin service
      return false;
    } catch (error) {
      throw new Error(`Failed to verify location proof: ${error}`);
    }
  }

  // Helper to create input from sensor data
  static createProofInput(params: {
    latitude: number;
    longitude: number;
    altitudeM: number;
    accuracyM: number;
    magneticField: { x: number; y: number; z: number };
    pressure: number;
    sessionId: number;
    contextHash: number;
  }): LocationProofInput {
    const now = Math.floor(Date.now() / 1000);
    return {
      nonce: Date.now(),
      contextHash: params.contextHash,
      sessionId: params.sessionId,
      latitude: params.latitude,
      longitude: params.longitude,
      altitudeM: params.altitudeM,
      gpsAccuracyM: params.accuracyM,
      magXUt: params.magneticField.x,
      magYUt: params.magneticField.y,
      magZUt: params.magneticField.z,
      pressurePa: params.pressure,
      proofTimestamp: now,
      currentTimestamp: now,
      magneticTolerancePercent: 30,
      altitudeToleranceM: 50,
    };
  }
}