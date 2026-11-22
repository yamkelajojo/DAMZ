use std::{env, io::{self, Read}};

use anyhow::{Context, Result};
use damz_gateway::crypto::{
    open_payment_notification, GatewayHpkeIdentity, PaymentConfirmedNotification,
};
use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};

const ED25519_PUBLIC_HEADER: [u8; 2] = [0xed, 0x01];
const ED25519_PRIVATE_HEADER: [u8; 2] = [0x80, 0x26];

#[derive(Serialize)]
struct Vector {
    gateway_did: String,
    gateway_private_multibase: String,
    runner_did: String,
    runner_private_multibase: String,
    notification: PaymentConfirmedNotification,
    envelope: String,
}

#[derive(Deserialize)]
struct OpenRequest {
    gateway_did: String,
    runner_did: String,
    runner_private_multibase: String,
    envelope: String,
}

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

fn main() -> Result<()> {
    if env::args().nth(1).as_deref() == Some("--open") {
        let mut input = String::new();
        io::stdin()
            .read_to_string(&mut input)
            .context("failed to read HPKE envelope request")?;
        let request: OpenRequest = serde_json::from_str(&input)?;
        let notification = open_payment_notification(
            &request.envelope,
            &request.gateway_did,
            &request.runner_did,
            &request.runner_private_multibase,
        )?;
        println!("{}", serde_json::to_string(&notification)?);
        return Ok(());
    }

    let (gateway_did, gateway_private_multibase) = did_and_private_key([17; 32]);
    let (runner_did, runner_private_multibase) = did_and_private_key([29; 32]);
    let gateway = GatewayHpkeIdentity::from_ed25519_did_private_key(
        gateway_did.clone(),
        &gateway_private_multibase,
    )?;
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
    let envelope = gateway.seal_for_runner(&runner_did, &notification)?;
    println!(
        "{}",
        serde_json::to_string(&Vector {
            gateway_did,
            gateway_private_multibase,
            runner_did,
            runner_private_multibase,
            notification,
            envelope,
        })?
    );
    Ok(())
}
