//! Authentication for payment-monitor callbacks.

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

use crate::crypto;

#[derive(Clone, Copy)]
pub struct MonitorRequestAuth<'a> {
    pub did: &'a str,
    pub signature_base64: &'a str,
    pub timestamp: i64,
    pub nonce: &'a str,
}

/// Verify exact callback bytes using the repository's `timestamp LE || nonce || body` format.
pub fn verify_monitor_request(
    auth: MonitorRequestAuth<'_>,
    expected_did: &str,
    body: &[u8],
    now: i64,
) -> Result<()> {
    if auth.did != expected_did {
        bail!("payment monitor DID is not trusted");
    }
    if auth.timestamp < now.saturating_sub(300) || auth.timestamp > now.saturating_add(300) {
        bail!("payment monitor callback timestamp is outside the allowed window");
    }
    if auth.nonce.len() < 16
        || auth.nonce.len() > 128
        || !auth
            .nonce
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        bail!("payment monitor nonce has an invalid format");
    }

    crypto::validate_ed25519_did(expected_did)?;
    let fingerprint = expected_did
        .strip_prefix("did:key:")
        .context("only did:key identifiers are supported")?;
    let encoded = fingerprint
        .strip_prefix('z')
        .context("expected base58btc multibase key material")?;
    let decoded = bs58::decode(encoded)
        .into_vec()
        .context("payment monitor DID is not valid base58btc")?;
    if decoded.len() != 34 || decoded[..2] != [0xed, 0x01] {
        bail!("payment monitor DID must contain a 32-byte Ed25519 key");
    }
    let public_bytes: [u8; 32] = decoded[2..]
        .try_into()
        .context("payment monitor DID key has an invalid length")?;
    let public_key = VerifyingKey::from_bytes(&public_bytes)
        .context("payment monitor DID contains an invalid public key")?;

    let signature_bytes = STANDARD
        .decode(auth.signature_base64)
        .context("payment monitor signature is not valid base64")?;
    let signature = Signature::from_slice(&signature_bytes)
        .context("payment monitor signature must be 64 bytes")?;
    let mut signed_payload = Vec::with_capacity(8 + auth.nonce.len() + body.len());
    signed_payload.extend_from_slice(&auth.timestamp.to_le_bytes());
    signed_payload.extend_from_slice(auth.nonce.as_bytes());
    signed_payload.extend_from_slice(body);
    public_key
        .verify(&signed_payload, &signature)
        .context("payment monitor signature verification failed")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn did_for(signing_key: &SigningKey) -> String {
        let mut fingerprint = vec![0xed, 0x01];
        fingerprint.extend_from_slice(signing_key.verifying_key().as_bytes());
        format!("did:key:z{}", bs58::encode(fingerprint).into_string())
    }

    #[test]
    fn verifies_only_the_exact_fresh_body_from_the_configured_monitor() {
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let did = did_for(&signing_key);
        let timestamp: i64 = 1_800_000_000;
        let nonce = "nonce_1234567890abcdef";
        let body = br#"{"amount_piconero":"100"}"#;
        let mut signed_payload = timestamp.to_le_bytes().to_vec();
        signed_payload.extend_from_slice(nonce.as_bytes());
        signed_payload.extend_from_slice(body);
        let signature = STANDARD.encode(signing_key.sign(&signed_payload).to_bytes());
        let auth = MonitorRequestAuth {
            did: &did,
            signature_base64: &signature,
            timestamp,
            nonce,
        };

        assert!(verify_monitor_request(auth, &did, body, timestamp).is_ok());
        assert!(verify_monitor_request(auth, &did, br#"{"amount_piconero":"101"}"#, timestamp).is_err());
        assert!(verify_monitor_request(auth, "did:key:untrusted", body, timestamp).is_err());
        assert!(verify_monitor_request(auth, &did, body, timestamp + 301).is_err());
    }

    #[test]
    fn rejects_malformed_nonce_values_before_signature_verification() {
        let signing_key = SigningKey::from_bytes(&[9; 32]);
        let did = did_for(&signing_key);
        let auth = MonitorRequestAuth {
            did: &did,
            signature_base64: "",
            timestamp: 1_800_000_000,
            nonce: "short",
        };
        assert!(verify_monitor_request(auth, &did, b"{}", auth.timestamp).is_err());
    }
}
