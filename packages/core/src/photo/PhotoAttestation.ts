/**
 * PhotoAttestation — Wrapper for @realreel/photo-attest
 *
 * Hardware-bound C2PA capture signing with Secure Enclave (iOS) / StrongBox (Android).
 * Device attestation via App Attest / KeyStore Attestation.
 */

import {
  PhotoAttest,
  SignC2PACaptureOptions,
  GenerateAndAttestKeyResult,
} from '@realreel/photo-attest';

export interface CaptureAndSignOptions {
  /**
   * Absolute path — or local `file://` URI — of the captured media to sign.
   * Required: native signs a real file, never an empty path.
   */
  mediaPath: string;
  /**
   * PEM cert chain issued by `register-signing-key` at enrollment (leaf-first).
   * Required: native rejects with `CERT_KEY_MISMATCH` when it is empty.
   */
  certChainPEM: string;
  /**
   * Signed-in user's UUID, written into `org.realreel.capture` for display
   * attribution. Informational (not a security claim); native rejects
   * `INVALID_CAPTURE_CONTEXT` when empty.
   */
  capturerUuid: string;
  gps?: { latitude: number; longitude: number; accuracy: number };
  /** Wall-clock capture time in Unix epoch milliseconds. */
  timestamp?: number;
  /** RFC 3161 TSA URL; omit when capturing offline. */
  tsaUrl?: string;
}

export interface AttestationResult {
  /** Absolute path of the C2PA-signed media file. */
  uri: string;
  /**
   * Active manifest URN, read back from the signed file. An empty string means
   * the native read-back failed: treat it as unknown and re-derive it from the
   * asset rather than assuming there is no manifest.
   */
  manifestId: string;
  metadata: {
    timestamp: number;
    gps?: { latitude: number; longitude: number; accuracy: number };
  };
}

export class PhotoAttestation {
  private static instance: PhotoAttestation;
  private keyAlias: string = 'realreel-capture-key';

  private constructor() {}

  static getInstance(): PhotoAttestation {
    if (!PhotoAttestation.instance) {
      PhotoAttestation.instance = new PhotoAttestation();
    }
    return PhotoAttestation.instance;
  }

  async initialize(): Promise<void> {
    // Generate a hardware key if one is not present yet. Hardware attestation
    // of that key happens during `enroll()` with a server-issued challenge.
    const hasKey = await PhotoAttest.hasKey(this.keyAlias);
    if (!hasKey) {
      await PhotoAttest.generateKey(this.keyAlias);
    }
  }

  async captureAndSign(options: CaptureAndSignOptions): Promise<AttestationResult> {
    if (!options.mediaPath) {
      throw new Error('captureAndSign: mediaPath is required');
    }
    if (!options.certChainPEM) {
      throw new Error(
        'captureAndSign: certChainPEM is required (obtained from server enrollment)'
      );
    }
    if (!options.capturerUuid) {
      throw new Error('captureAndSign: capturerUuid is required');
    }

    try {
      const captureOptions: SignC2PACaptureOptions = {
        certChainPEM: options.certChainPEM,
        capturerUuid: options.capturerUuid,
        gps: options.gps,
        captureTimestampMs: options.timestamp ?? Date.now(),
        tsaUrl: options.tsaUrl,
      };

      const result = await PhotoAttest.signC2PACapture(
        this.keyAlias,
        options.mediaPath,
        captureOptions
      );

      // Return only what the native module actually produced. The previous
      // implementation returned empty strings for a C2PA manifest, an
      // attestation token and a signature that native never provided — a result
      // that looked like evidence but certified nothing.
      return {
        uri: result.signedMediaPath,
        manifestId: result.manifestId,
        metadata: {
          timestamp: options.timestamp ?? Date.now(),
          gps: options.gps,
        },
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
    // Not implemented. Verify the C2PA manifest with a c2pa reader against the
    // trust list and validate the device attestation token. This throws rather
    // than returning `{ valid: false }` so callers cannot silently ship code
    // that treats every capture as merely "unverified".
    throw new Error(
      'PhotoAttestation.verifyAttestation is not implemented. ' +
        'Verify the C2PA manifest with a c2pa reader and validate the device attestation token.'
    );
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      const supported = await PhotoAttest.isHardwareSupported();
      return { available: supported };
    } catch (error) {
      return { available: false, reason: String(error) };
    }
  }

  // Enrollment flow - generate key and get CSR for server
  async enroll(challengeBase64: string): Promise<GenerateAndAttestKeyResult> {
    return PhotoAttest.generateAndAttestKey(this.keyAlias, challengeBase64);
  }

  // Get CSR for server enrollment
  async getCSR(): Promise<string> {
    return PhotoAttest.generateCSR(this.keyAlias);
  }
}
