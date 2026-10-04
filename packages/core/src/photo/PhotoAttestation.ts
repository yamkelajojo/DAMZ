/**
 * PhotoAttestation — Wrapper for @realreel/photo-attest
 *
 * Hardware-bound C2PA capture signing with Secure Enclave (iOS) / StrongBox (Android).
 * Device attestation via App Attest / KeyStore Attestation.
 */

import { PhotoAttest } from '@realreel/photo-attest';

export interface AttestationResult {
  uri: string; // Local file URI of signed photo
  c2paManifest: string; // JSON string of C2PA manifest
  attestationToken: string; // Device attestation token (App Attest / KeyStore)
  signature: string; // ECDSA P-256 signature over photo hash + metadata
  metadata: {
    timestamp: number;
    gps?: { latitude: number; longitude: number; accuracy: number };
    deviceInfo: string;
  };
}

export class PhotoAttestation {
  private static instance: PhotoAttestation;
  private photoAttest: any;

  private constructor() {
    this.photoAttest = new PhotoAttest();
  }

  static getInstance(): PhotoAttestation {
    if (!PhotoAttestation.instance) {
      PhotoAttestation.instance = new PhotoAttestation();
    }
    return PhotoAttestation.instance;
  }

  async initialize(): Promise<void> {
    try {
      await this.photoAttest.initialize();
    } catch (error) {
      throw new Error(`Failed to initialize photo attestation: ${error}`);
    }
  }

  async captureAndSign(options: {
    orderId: string;
    timestamp?: number;
    gps?: { latitude: number; longitude: number; accuracy: number };
  }): Promise<AttestationResult> {
    try {
      const result = await this.photoAttest.captureAndSign({
        orderId: options.orderId,
        timestamp: options.timestamp ?? Date.now(),
        gps: options.gps,
      });

      return {
        uri: result.uri,
        c2paManifest: result.c2paManifest,
        attestationToken: result.attestationToken,
        signature: result.signature,
        metadata: result.metadata,
      };
    } catch (error) {
      throw new Error(`Failed to capture and sign photo: ${error}`);
    }
  }

  async verifyAttestation(
    photoUri: string,
    c2paManifest: string,
    attestationToken: string
  ): Promise<{ valid: boolean; details: string }> {
    try {
      const result = await this.photoAttest.verifyAttestation({
        photoUri,
        c2paManifest,
        attestationToken,
      });

      return {
        valid: result.valid,
        details: result.details,
      };
    } catch (error) {
      throw new Error(`Failed to verify attestation: ${error}`);
    }
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      return await this.photoAttest.isAvailable();
    } catch (error) {
      return { available: false, reason: String(error) };
    }
  }
}