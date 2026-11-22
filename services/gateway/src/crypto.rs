//! Gateway DID parsing and the shared HPKE payment notification wire format.

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::{SigningKey, VerifyingKey};
use hpke::{
    aead::AesGcm256,
    kdf::HkdfSha256,
    kem::X25519HkdfSha256,
    Deserializable, Kem as KemTrait, OpModeR, OpModeS, Serializable,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use uuid::Uuid;
use zeroize::Zeroizing;

const INFO_PREFIX: &str = "DAMZ/relay/payment-notification/v1";
const MAX_ENVELOPE_BYTES: usize = 64 * 1024;
const ED25519_PUBLIC_HEADER: [u8; 2] = [0xed, 0x01];
const ED25519_PRIVATE_HEADER: [u8; 2] = [0x80, 0x26];

type PaymentKem = X25519HkdfSha256;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentConfirmedNotification {
    #[serde(rename = "type")]
    pub notification_type: String,
    pub event_id: String,
    pub issued_at: i64,
    pub order_id: String,
    pub subaddress: String,
    pub txid: String,
    pub amount_piconero: String,
    pub confirmations: u64,
}

#[derive(Deserialize, Serialize)]
struct HpkeEnvelope {
    version: u8,
    enc: String,
    ciphertext: String,
}

pub struct GatewayHpkeIdentity {
    did: String,
    private_key: <PaymentKem as KemTrait>::PrivateKey,
    public_key: <PaymentKem as KemTrait>::PublicKey,
}

impl GatewayHpkeIdentity {
    /// Converts the configured Ed25519 `did:key` secret into its matching
    /// X25519 Auth-mode key and verifies the public key against the DID.
    pub fn from_ed25519_did_private_key(did: String, private_multibase: &str) -> Result<Self> {
        let (private_key, public_key) = derive_did_key_agreement_keypair(&did, private_multibase)?;

        Ok(Self {
            did,
            private_key,
            public_key,
        })
    }

    pub fn did(&self) -> &str {
        &self.did
    }

    pub fn seal_for_runner(
        &self,
        runner_did: &str,
        notification: &PaymentConfirmedNotification,
    ) -> Result<String> {
        let recipient_bytes = did_key_x25519_public_key(runner_did)?;
        let recipient_public_key =
            <<PaymentKem as KemTrait>::PublicKey as Deserializable>::from_bytes(&recipient_bytes)
                .context("Runner DID contains an invalid X25519 key-agreement key")?;
        let info = context_info(&self.did, runner_did);
        let aad = additional_data(&self.did, runner_did);
        let mode = OpModeS::Auth((self.private_key.clone(), self.public_key.clone()));
        let (enc, mut context) = hpke::setup_sender::<AesGcm256, HkdfSha256, PaymentKem>(
            &mode,
            &recipient_public_key,
            &info,
        )
        .context("failed to set up HPKE payment notification")?;
        let plaintext = serde_json::to_vec(notification)
            .context("failed to serialize payment notification")?;
        let ciphertext = context
            .seal(&plaintext, &aad)
            .context("failed to encrypt payment notification")?;
        let envelope = HpkeEnvelope {
            version: 1,
            enc: STANDARD.encode(enc.to_bytes()),
            ciphertext: STANDARD.encode(ciphertext),
        };
        let serialized =
            serde_json::to_string(&envelope).context("failed to serialize HPKE envelope")?;
        if serialized.len() > MAX_ENVELOPE_BYTES {
            bail!("payment notification envelope exceeds the relay size limit");
        }
        Ok(serialized)
    }
}

/// Open a Runner test/vector envelope using its Ed25519 DID key material.
/// Production Runner code performs this operation in TypeScript.
pub fn open_payment_notification(
    serialized_envelope: &str,
    expected_gateway_did: &str,
    runner_did: &str,
    runner_private_multibase: &str,
) -> Result<PaymentConfirmedNotification> {
    if serialized_envelope.len() > MAX_ENVELOPE_BYTES {
        bail!("payment notification envelope exceeds the relay size limit");
    }
    let envelope: HpkeEnvelope =
        serde_json::from_str(serialized_envelope).context("invalid HPKE envelope JSON")?;
    if envelope.version != 1 {
        bail!("unsupported payment notification envelope version");
    }
    let enc = STANDARD.decode(envelope.enc).context("invalid HPKE enc base64")?;
    let ciphertext = STANDARD
        .decode(envelope.ciphertext)
        .context("invalid HPKE ciphertext base64")?;
    let (runner_private_key, _) =
        derive_did_key_agreement_keypair(runner_did, runner_private_multibase)?;
    let sender_bytes = did_key_x25519_public_key(expected_gateway_did)?;
    let sender_public_key =
        <<PaymentKem as KemTrait>::PublicKey as Deserializable>::from_bytes(&sender_bytes)
            .context("trusted Gateway DID has an invalid X25519 public key")?;
    let info = context_info(expected_gateway_did, runner_did);
    let aad = additional_data(expected_gateway_did, runner_did);
    let enc = <<PaymentKem as KemTrait>::EncappedKey as Deserializable>::from_bytes(&enc)
        .context("invalid HPKE encapsulated key")?;
    let mode = OpModeR::Auth(sender_public_key);
    let mut context = hpke::setup_receiver::<AesGcm256, HkdfSha256, PaymentKem>(
        &mode,
        &runner_private_key,
        &enc,
        &info,
    )
    .context("failed to set up HPKE recipient context")?;
    let plaintext = context
        .open(&ciphertext, &aad)
        .context("payment notification authentication or decryption failed")?;
    let notification: PaymentConfirmedNotification =
        serde_json::from_slice(&plaintext).context("invalid payment notification payload")?;
    validate_notification(&notification)?;
    Ok(notification)
}

fn derive_did_key_agreement_keypair(
    did: &str,
    private_multibase: &str,
) -> Result<(
    <PaymentKem as KemTrait>::PrivateKey,
    <PaymentKem as KemTrait>::PublicKey,
)> {
    let ed_public = did_key_ed25519_public_key(did)?;
    let ed_private = Zeroizing::new(decode_multibase_key(
        private_multibase,
        ED25519_PRIVATE_HEADER,
    )?);
    if ed_private.len() != 32 && ed_private.len() != 64 {
        bail!("Ed25519 private key must contain a 32-byte seed or 64-byte key");
    }
    let signing_key = SigningKey::from_bytes(
        ed_private[..32]
            .try_into()
            .context("invalid Ed25519 seed")?,
    );
    let did_signing_public = VerifyingKey::from_bytes(&ed_public)
        .context("DID contains an invalid Ed25519 public key")?;
    if signing_key.verifying_key() != did_signing_public {
        bail!("Ed25519 private key does not match its DID");
    }
    if ed_private.len() == 64 && ed_private[32..] != ed_public {
        bail!("Ed25519 private key's embedded public key does not match its DID");
    }

    let ed_point = CompressedEdwardsY(ed_public)
        .decompress()
        .context("DID contains an invalid Ed25519 point")?;
    if ed_point.compress().to_bytes() != ed_public {
        bail!("DID Ed25519 public key is not canonically encoded");
    }
    let expected_x25519_public = ed_point.to_montgomery().to_bytes();
    // Match Digital Bazaar's conversion: clamp(SHA-512(seed)[0..32]).
    let digest = Zeroizing::new(Sha512::digest(&ed_private[..32]).to_vec());
    let mut secret_bytes = Zeroizing::new(
        <[u8; 32]>::try_from(&digest[..32]).context("failed to derive X25519 secret")?,
    );
    secret_bytes[0] &= 248;
    secret_bytes[31] &= 127;
    secret_bytes[31] |= 64;
    let private_key = <<PaymentKem as KemTrait>::PrivateKey as Deserializable>::from_bytes(
        &secret_bytes[..],
    )
    .context("failed to deserialize X25519 private key")?;
    let public_key = PaymentKem::sk_to_pk(&private_key);
    let expected_public_key =
        <<PaymentKem as KemTrait>::PublicKey as Deserializable>::from_bytes(
            &expected_x25519_public,
        )
        .context("failed to deserialize DID X25519 public key")?;
    if public_key != expected_public_key {
        bail!("X25519 key-agreement key does not match its Ed25519 DID");
    }
    Ok((private_key, public_key))
}

fn validate_notification(notification: &PaymentConfirmedNotification) -> Result<()> {
    if notification.notification_type != "payment.confirmed"
        || Uuid::parse_str(&notification.event_id)
            .map(|event_id| event_id.get_version() != Some(uuid::Version::Random))
            .unwrap_or(true)
        || notification.issued_at <= 0
        || Uuid::parse_str(&notification.order_id).is_err()
        || notification.subaddress.is_empty()
        || notification.txid.len() != 64
        || !notification.txid.bytes().all(|byte| byte.is_ascii_hexdigit())
        || notification.amount_piconero.is_empty()
        || !notification
            .amount_piconero
            .bytes()
            .all(|byte| byte.is_ascii_digit())
        || notification.confirmations < 3
    {
        bail!("payment notification payload is invalid");
    }
    Ok(())
}

pub fn validate_ed25519_did(did: &str) -> Result<()> {
    let public = did_key_ed25519_public_key(did)?;
    VerifyingKey::from_bytes(&public).context("DID contains an invalid Ed25519 public key")?;
    Ok(())
}

fn did_key_ed25519_public_key(did: &str) -> Result<[u8; 32]> {
    let fingerprint = did
        .strip_prefix("did:key:")
        .context("only did:key identifiers are supported")?;
    let key = decode_multibase_key(fingerprint, ED25519_PUBLIC_HEADER)?;
    key.try_into()
        .map_err(|_| anyhow::anyhow!("Ed25519 DID public key must be 32 bytes"))
}

fn did_key_x25519_public_key(did: &str) -> Result<[u8; 32]> {
    let ed_public = did_key_ed25519_public_key(did)?;
    let point = CompressedEdwardsY(ed_public)
        .decompress()
        .context("Runner DID contains an invalid Ed25519 point")?;
    if point.compress().to_bytes() != ed_public {
        bail!("Runner DID Ed25519 public key is not canonically encoded");
    }
    Ok(point.to_montgomery().to_bytes())
}

fn decode_multibase_key(value: &str, expected_header: [u8; 2]) -> Result<Vec<u8>> {
    let base58 = value
        .strip_prefix('z')
        .context("expected base58btc multibase key material")?;
    let decoded = bs58::decode(base58)
        .into_vec()
        .context("DID key material is not valid base58btc")?;
    if decoded.len() < expected_header.len() || decoded[..2] != expected_header {
        bail!("DID key material has an unexpected multicodec header");
    }
    Ok(decoded[2..].to_vec())
}

fn context_info(gateway_did: &str, runner_did: &str) -> Vec<u8> {
    format!("{INFO_PREFIX}\0{gateway_did}\0{runner_did}").into_bytes()
}

fn additional_data(gateway_did: &str, runner_did: &str) -> Vec<u8> {
    format!("gateway={gateway_did}\nrunner={runner_did}").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn did_and_private_key(seed: [u8; 32]) -> (String, String) {
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = signing_key.verifying_key().to_bytes();
        let mut public_multicodec = ED25519_PUBLIC_HEADER.to_vec();
        public_multicodec.extend_from_slice(&public_key);
        let mut private_multicodec = ED25519_PRIVATE_HEADER.to_vec();
        private_multicodec.extend_from_slice(&seed);
        private_multicodec.extend_from_slice(&public_key);
        (
            format!("did:key:z{}", bs58::encode(public_multicodec).into_string()),
            format!("z{}", bs58::encode(private_multicodec).into_string()),
        )
    }

    #[test]
    fn gateway_hpke_auth_envelope_round_trips_only_for_the_pinned_dids() {
        let (gateway_did, gateway_private_key) = did_and_private_key([17; 32]);
        let (runner_did, runner_private_key) = did_and_private_key([29; 32]);
        let identity =
            GatewayHpkeIdentity::from_ed25519_did_private_key(gateway_did.clone(), &gateway_private_key)
                .unwrap();
        let notification = PaymentConfirmedNotification {
            notification_type: "payment.confirmed".to_owned(),
            event_id: "123e4567-e89b-42d3-a456-426614174000".to_owned(),
            issued_at: 1_800_000_000,
            order_id: "123e4567-e89b-42d3-a456-426614174001".to_owned(),
            subaddress: format!("8{}", "A".repeat(94)),
            txid: "a".repeat(64),
            amount_piconero: "18517500000".to_owned(),
            confirmations: 3,
        };
        let envelope = identity.seal_for_runner(&runner_did, &notification).unwrap();

        assert!(!envelope.contains(&notification.order_id));
        assert_eq!(
            open_payment_notification(
                &envelope,
                &gateway_did,
                &runner_did,
                &runner_private_key,
            )
            .unwrap(),
            notification
        );
        assert!(open_payment_notification(
            &envelope,
            "did:key:untrusted",
            &runner_did,
            &runner_private_key,
        )
        .is_err());
    }

    #[test]
    fn gateway_private_key_must_match_its_configured_did() {
        let (gateway_did, _) = did_and_private_key([17; 32]);
        let (_, other_private_key) = did_and_private_key([31; 32]);
        assert!(GatewayHpkeIdentity::from_ed25519_did_private_key(
            gateway_did,
            &other_private_key
        )
        .is_err());
    }
}
