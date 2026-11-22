//! DAMZ Admin — DID signature verification
//!
//! Verifies Ed25519 signatures from did:key DIDs over `timestamp + nonce + body`.

use anyhow::{Context, Result};
use base64::engine::{general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey, Verifier};
use bs58;

/// Parse a did:key Ed25519 DID and return the raw 32-byte public key.
///
/// Format: `did:key:z6Mk<base58btc-encoded-32-byte-public-key>`
/// - `z` = base58btc multibase prefix
/// - `6Mk` = Ed25519 public key multicodec (0xED 0x01)
pub fn parse_did_key_public_key(did: &str) -> Result<[u8; 32]> {
    let suffix = did
        .strip_prefix("did:key:z6Mk")
        .context("DID is not a did:key:z6Mk Ed25519 identifier")?;

    let bytes = bs58::decode(suffix)
        .into_vec()
        .context("failed to base58btc-decode DID key material")?;

    if bytes.len() < 34 {
        anyhow::bail!("decoded DID key material too short ({} bytes)", bytes.len());
    }
    if bytes[0] != 0xED || bytes[1] != 0x01 {
        anyhow::bail!("unexpected multicodec header in did:key material");
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes[2..34]);
    Ok(key)
}

/// Verify an Ed25519 signature from a did:key DID.
///
/// Signed payload: `timestamp + nonce + body` (concatenated bytes).
pub fn verify_did_signature(
    did: &str,
    signature_b64: &str,
    timestamp: i64,
    nonce: &str,
    body: &[u8],
) -> Result<()> {
    let public_key = parse_did_key_public_key(did)?;
    let verifying_key = VerifyingKey::from_bytes(&public_key)
        .context("invalid Ed25519 public key in DID")?;

    let signature_bytes = STANDARD
        .decode(signature_b64)
        .context("signature is not valid base64")?;

    if signature_bytes.len() != 64 {
        anyhow::bail!("signature is not 64 bytes");
    }

    let signature = Signature::from_slice(&signature_bytes)
        .context("invalid Ed25519 signature")?;

    // Build signed payload: timestamp (LE i64) + nonce (UTF-8) + body
    let mut payload = Vec::with_capacity(8 + nonce.len() + body.len());
    payload.extend_from_slice(&timestamp.to_le_bytes());
    payload.extend_from_slice(nonce.as_bytes());
    payload.extend_from_slice(body);

    verifying_key
        .verify(&payload, &signature)
        .context("Ed25519 signature verification failed")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_did_key_invalid_prefix() {
        let result = parse_did_key_public_key("did:key:invalid");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_did_key_too_short() {
        let result = parse_did_key_public_key("did:key:z6Mkabc");
        assert!(result.is_err());
    }
}