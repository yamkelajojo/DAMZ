# Photo attestation: @realreel/photo-attest (C2PA + device attestation)

**Status**: accepted

Use `@realreel/photo-attest` for hardware-bound C2PA capture signing with Secure Enclave (iOS) / StrongBox (Android) and device attestation (App Attest / KeyStore Attestation).

**Context**: SPEC recommended this. Grilling confirmed over lighter alternatives (`react-native-biometric-signature`, Vouch Protocol) because C2PA envelope + device attestation token provides the strongest evidence for dispute resolution.

**Consequences**:
- **Install**: `bun add @realreel/photo-attest` + JitPack Maven for `c2pa-android` transitive.
- **iOS**: Deployment target 16.0. Generates ECDSA P-256 in Secure Enclave. App Attest attestation per capture.
- **Android**: minSdk 28. StrongBox on Pixel/Samsung Knox, fallback to TEE. KeyStore Attestation per capture.
- **Output**: C2PA-signed JPEG/HEIC with embedded manifest (hash + timestamp + attestation token).
- **Verification**: Customer app verifies C2PA manifest + attestation token + signature. Admin can verify in dispute.
- **Binary size**: Adds ~2-3MB (c2pa-android native lib). Acceptable.
- **Fallback**: If StrongBox unavailable, falls back to TEE. Document in UX: "Best evidence on Pixel/Samsung; other devices still sign but with weaker hardware guarantee."