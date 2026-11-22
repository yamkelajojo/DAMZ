//! DAMZ Monero Gateway HTTP API.

use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{bail, Context, Result};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{header::HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tracing::{info, warn};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    auth::{verify_monitor_request, MonitorRequestAuth},
    crypto::{validate_ed25519_did, GatewayHpkeIdentity, PaymentConfirmedNotification},
    models::{PaymentRecord, PaymentStatus},
};

const MAX_CALLBACK_BODY_BYTES: usize = 16 * 1024;
const MAX_RELAY_TTL_SECONDS: u64 = 7 * 24 * 60 * 60;
const MAX_PAYMENT_LIFETIME_SECONDS: u64 = 24 * 60 * 60;
const MIN_PAYMENT_LIFETIME_SECONDS: u64 = 60;
const MONITOR_TIMESTAMP_WINDOW_SECONDS: i64 = 300;
const NONCE_RETENTION_SECONDS: i64 = 600;

#[derive(Clone)]
pub struct AppState {
    payments: Arc<RwLock<HashMap<String, PaymentRecord>>>,
    notifications: NotificationConfig,
    used_nonces: Arc<Mutex<HashMap<String, i64>>>,
}

#[derive(Clone)]
enum NotificationConfig {
    Disabled,
    Enabled {
        gateway_identity: Arc<GatewayHpkeIdentity>,
        payment_monitor_did: String,
        relay_http_url: String,
        relay_client: reqwest::Client,
    },
}

impl AppState {
    fn notifications_disabled() -> Self {
        Self {
            payments: Arc::new(RwLock::new(HashMap::new())),
            notifications: NotificationConfig::Disabled,
            used_nonces: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn with_notifications(
        gateway_did: String,
        gateway_private_key_multibase: &str,
        payment_monitor_did: String,
        relay_http_url: String,
    ) -> Result<Self> {
        validate_ed25519_did(&payment_monitor_did)
            .context("PAYMENT_MONITOR_DID is invalid")?;
        let gateway_identity = GatewayHpkeIdentity::from_ed25519_did_private_key(
            gateway_did,
            gateway_private_key_multibase,
        )
        .context("GATEWAY_PRIVATE_KEY_MULTIBASE does not match GATEWAY_DID")?;
        let relay_http_url = validate_relay_http_url(&relay_http_url)?;
        let relay_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .context("failed to create relay HTTP client")?;

        Ok(Self {
            payments: Arc::new(RwLock::new(HashMap::new())),
            notifications: NotificationConfig::Enabled {
                gateway_identity: Arc::new(gateway_identity),
                payment_monitor_did,
                relay_http_url,
                relay_client,
            },
            used_nonces: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    fn consume_nonce(&self, nonce: &str, now: i64) -> bool {
        record_nonce(&self.used_nonces, nonce, now)
    }
}

#[derive(Debug, Deserialize)]
struct CreatePaymentRequest {
    order_id: String,
    runner_did: String,
    runner_onion_hash: String,
    amount_zar: String,
    rate_xmr_per_zar: String,
    expires_in_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
struct CreatePaymentResponse {
    subaddress: String,
    amount_xmr: String,
    amount_piconero: String,
    expires_at: i64,
    payment_id: String,
}

#[derive(Debug, Serialize)]
struct PaymentStatusResponse {
    status: String,
    amount_received_piconero: String,
    confirmations: u64,
    txid: Option<String>,
}

/// Signed by the configured payment-monitor DID over the raw JSON body.
/// Recipient routing is deliberately not part of this callback.
#[derive(Clone, Debug, Deserialize)]
struct PaymentCallback {
    order_id: String,
    subaddress: String,
    txid: String,
    amount_piconero: String,
    confirmations: u64,
    confirmed_at: i64,
}

#[derive(Debug, Deserialize)]
struct RelayReceipt {
    blob_id: Uuid,
    expires_at: i64,
}

#[derive(Debug, Serialize)]
struct NotificationAccepted {
    status: &'static str,
    event_id: String,
}

pub async fn run() -> Result<()> {
    let port = std::env::var("GATEWAY_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(3001);
    let notifications_enabled = parse_notifications_enabled(
        std::env::var("GATEWAY_PAYMENT_NOTIFICATIONS_ENABLED").ok().as_deref(),
    )?;

    let state = if notifications_enabled {
        let gateway_did = std::env::var("GATEWAY_DID").context("GATEWAY_DID required")?;
        let gateway_private_key_multibase = Zeroizing::new(
            std::env::var("GATEWAY_PRIVATE_KEY_MULTIBASE")
                .context("GATEWAY_PRIVATE_KEY_MULTIBASE required")?,
        );
        let payment_monitor_did =
            std::env::var("PAYMENT_MONITOR_DID").context("PAYMENT_MONITOR_DID required")?;
        let relay_http_url = std::env::var("RELAY_HTTP_URL").context("RELAY_HTTP_URL required")?;
        AppState::with_notifications(
            gateway_did,
            gateway_private_key_multibase.as_str(),
            payment_monitor_did,
            relay_http_url,
        )?
    } else {
        AppState::notifications_disabled()
    };

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await?;
    info!(port, "DAMZ Gateway starting in mock payment-provider mode on {}", addr);
    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    info!("DAMZ Gateway shut down");
    Ok(())
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/receive", post(create_payment))
        .route("/receive/:subaddress", get(payment_status))
        .route("/notify/payment", post(notify_payment))
        .route("/health", get(health))
        .layer(DefaultBodyLimit::max(MAX_CALLBACK_BODY_BYTES))
        .with_state(state)
}

async fn create_payment(
    State(state): State<AppState>,
    Json(payload): Json<CreatePaymentRequest>,
) -> Response {
    if Uuid::parse_str(&payload.order_id).is_err() {
        return ApiError::bad_request("order_id must be a UUID").into_response();
    }
    if validate_ed25519_did(&payload.runner_did).is_err() {
        return ApiError::bad_request("runner_did must be a valid Ed25519 did:key").into_response();
    }
    if !is_recipient_hash(&payload.runner_onion_hash) {
        return ApiError::bad_request("runner_onion_hash must be 64 hexadecimal characters")
            .into_response();
    }

    let amount_piconero = match zar_and_rate_to_piconero(
        &payload.amount_zar,
        &payload.rate_xmr_per_zar,
    ) {
        Ok(amount) => amount,
        Err(message) => return ApiError::bad_request(message).into_response(),
    };
    let expires_in = payload.expires_in_seconds.unwrap_or(900);
    if !(MIN_PAYMENT_LIFETIME_SECONDS..=MAX_PAYMENT_LIFETIME_SECONDS).contains(&expires_in) {
        return ApiError::bad_request("expires_in_seconds must be between 60 and 86400")
            .into_response();
    }
    let now = now_secs();
    let Some(expires_at) = now.checked_add(expires_in as i64) else {
        return ApiError::bad_request("payment expiry is outside the supported range")
            .into_response();
    };

    let subaddress = generate_subaddress();
    let payment_id = Uuid::new_v4().to_string();
    let record = PaymentRecord {
        id: payment_id.clone(),
        order_id: payload.order_id.clone(),
        runner_did: payload.runner_did,
        runner_onion_hash: payload.runner_onion_hash.to_ascii_lowercase(),
        notification_event_id: Uuid::new_v4().to_string(),
        notification_issued_at: None,
        notification_confirmations: None,
        subaddress: subaddress.clone(),
        amount_piconero,
        expires_at,
        status: PaymentStatus::Pending,
        amount_received_piconero: 0,
        confirmations: 0,
        txid: None,
        created_at: now,
    };

    state.payments.write().insert(payment_id.clone(), record);
    info!("payment request created");

    Json(CreatePaymentResponse {
        subaddress,
        amount_xmr: format_piconero_as_xmr(amount_piconero),
        amount_piconero: amount_piconero.to_string(),
        expires_at,
        payment_id,
    })
    .into_response()
}

async fn payment_status(State(state): State<AppState>, Path(subaddress): Path<String>) -> Response {
    let payments = state.payments.read();
    let record = payments.values().find(|record| record.subaddress == subaddress);
    match record {
        Some(record) => {
            let status = if record.status == PaymentStatus::Confirmed {
                PaymentStatus::Confirmed
            } else if now_secs() > record.expires_at {
                PaymentStatus::Expired
            } else {
                record.status.clone()
            };
            Json(PaymentStatusResponse {
                status: status.to_string(),
                amount_received_piconero: record.amount_received_piconero.to_string(),
                confirmations: record.confirmations,
                txid: record.txid.clone(),
            })
            .into_response()
        }
        None => ApiError::not_found("payment not found").into_response(),
    }
}

async fn notify_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let NotificationConfig::Enabled {
        gateway_identity,
        payment_monitor_did,
        relay_http_url,
        relay_client,
    } = &state.notifications
    else {
        return ApiError::unavailable("encrypted payment notifications are disabled")
            .into_response();
    };
    if body.len() > MAX_CALLBACK_BODY_BYTES {
        return ApiError::bad_request("payment callback is too large").into_response();
    }
    let now = now_secs();
    let Some(auth) = callback_auth_headers(&headers) else {
        return ApiError::unauthorized("missing or invalid payment-monitor authentication")
            .into_response();
    };
    if verify_monitor_request(auth, payment_monitor_did, &body, now).is_err() {
        warn!("rejected unauthenticated payment-monitor callback");
        return ApiError::unauthorized("payment-monitor authentication failed").into_response();
    }
    let Some(nonce) = headers
        .get("X-DAMZ-Nonce")
        .and_then(|value| value.to_str().ok())
    else {
        return ApiError::unauthorized("missing or invalid payment-monitor nonce").into_response();
    };
    if !state.consume_nonce(nonce, now) {
        return ApiError::unauthorized("payment-monitor callback was already used").into_response();
    }

    let callback: PaymentCallback = match serde_json::from_slice(&body) {
        Ok(callback) => callback,
        Err(_) => return ApiError::bad_request("invalid payment callback JSON").into_response(),
    };
    if !is_txid(&callback.txid)
        || callback.confirmations < 3
        || callback.confirmed_at <= 0
        || callback.confirmed_at > now.saturating_add(MONITOR_TIMESTAMP_WINDOW_SECONDS)
    {
        return ApiError::bad_request("payment callback does not represent a confirmed payment")
            .into_response();
    }
    let amount_received_piconero = match callback.amount_piconero.parse::<u64>() {
        Ok(amount) if amount > 0 => amount,
        _ => return ApiError::bad_request("amount_piconero must be a positive integer string")
            .into_response(),
    };

    let notification = {
        let mut payments = state.payments.write();
        let Some(record) = payments.values_mut().find(|record| {
            record.order_id == callback.order_id && record.subaddress == callback.subaddress
        }) else {
            return ApiError::not_found("payment not found").into_response();
        };
        if amount_received_piconero < record.amount_piconero {
            return ApiError::bad_request("confirmed amount is below the requested amount")
                .into_response();
        }

        if record.status == PaymentStatus::Confirmed {
            if record.txid.as_deref() != Some(callback.txid.as_str())
                || record.amount_received_piconero != amount_received_piconero
            {
                return ApiError::conflict("confirmed payment details do not match")
                    .into_response();
            }
            record.confirmations = record.confirmations.max(callback.confirmations);
        } else {
            record.status = PaymentStatus::Confirmed;
            record.amount_received_piconero = amount_received_piconero;
            record.confirmations = callback.confirmations;
            record.txid = Some(callback.txid.clone());
            record.notification_issued_at = Some(now);
            record.notification_confirmations = Some(callback.confirmations);
        }

        PaymentConfirmedNotification {
            notification_type: "payment.confirmed".to_owned(),
            event_id: record.notification_event_id.clone(),
            issued_at: record.notification_issued_at.unwrap_or(now),
            order_id: record.order_id.clone(),
            subaddress: record.subaddress.clone(),
            txid: record.txid.clone().unwrap_or_default(),
            amount_piconero: record.amount_received_piconero.to_string(),
            confirmations: record.notification_confirmations.unwrap_or(3),
        }
    };

    // Route only to the DID/hash captured when the payment was created.
    let runner = {
        let payments = state.payments.read();
        payments
            .values()
            .find(|record| record.order_id == callback.order_id && record.subaddress == callback.subaddress)
            .map(|record| (record.runner_did.clone(), record.runner_onion_hash.clone()))
    };
    let Some((runner_did, runner_onion_hash)) = runner else {
        return ApiError::not_found("payment not found").into_response();
    };
    let envelope = match gateway_identity.seal_for_runner(&runner_did, &notification) {
        Ok(envelope) => envelope,
        Err(_) => {
            warn!("failed to encrypt payment notification");
            return ApiError::internal("could not encrypt payment notification").into_response();
        }
    };

    let relay_endpoint = format!(
        "{}/blob/{}",
        relay_http_url,
        runner_onion_hash.to_ascii_lowercase()
    );
    let relay_response = match relay_client
        .put(relay_endpoint)
        .header("X-Expiry", MAX_RELAY_TTL_SECONDS.to_string())
        .header("Content-Type", "application/octet-stream")
        .body(envelope)
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            warn!("relay enqueue request failed");
            return ApiError::unavailable("payment confirmed, but relay enqueue failed")
                .into_response();
        }
    };
    if relay_response.status() != StatusCode::ACCEPTED {
        warn!(status = %relay_response.status(), "relay did not accept payment notification");
        return ApiError::unavailable("payment confirmed, but relay did not accept notification")
            .into_response();
    }
    let receipt: RelayReceipt = match relay_response.json::<RelayReceipt>().await {
        Ok(receipt) if receipt.expires_at > now => receipt,
        _ => {
            return ApiError::bad_gateway("relay returned an invalid enqueue receipt")
                .into_response();
        }
    };

    info!(relay_blob_id = %receipt.blob_id, "encrypted payment notification accepted by relay");
    (
        StatusCode::ACCEPTED,
        Json(NotificationAccepted {
            status: "queued",
            event_id: notification.event_id,
        }),
    )
        .into_response()
}

fn callback_auth_headers(headers: &HeaderMap) -> Option<MonitorRequestAuth<'_>> {
    let did = headers.get("X-DAMZ-DID")?.to_str().ok()?;
    let signature_base64 = headers.get("X-DAMZ-Signature")?.to_str().ok()?;
    let timestamp = headers.get("X-DAMZ-Timestamp")?.to_str().ok()?.parse().ok()?;
    let nonce = headers.get("X-DAMZ-Nonce")?.to_str().ok()?;
    Some(MonitorRequestAuth { did, signature_base64, timestamp, nonce })
}

fn record_nonce(cache: &Mutex<HashMap<String, i64>>, nonce: &str, now: i64) -> bool {
    let mut used_nonces = cache.lock();
    used_nonces.retain(|_, seen_at| now.saturating_sub(*seen_at) <= NONCE_RETENTION_SECONDS);
    if used_nonces.contains_key(nonce) {
        return false;
    }
    used_nonces.insert(nonce.to_owned(), now);
    true
}

async fn health() -> Response {
    Json(serde_json::json!({ "status": "ok", "service": "gateway" })).into_response()
}

fn validate_relay_http_url(value: &str) -> Result<String> {
    let url = reqwest::Url::parse(value).context("RELAY_HTTP_URL is invalid")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.host_str().is_some_and(|host| host.ends_with(".onion"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        bail!("RELAY_HTTP_URL must be a non-onion HTTP(S) origin");
    }
    Ok(url.origin().ascii_serialization().trim_end_matches('/').to_owned())
}

fn parse_notifications_enabled(value: Option<&str>) -> Result<bool> {
    match value {
        None | Some("false") => Ok(false),
        Some("true") => Ok(true),
        Some(_) => bail!("GATEWAY_PAYMENT_NOTIFICATIONS_ENABLED must be true or false"),
    }
}

fn is_recipient_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_txid(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Parse a base-10 decimal without floating-point rounding.
fn parse_decimal(value: &str, maximum_fraction_digits: usize) -> Option<(u128, u32)> {
    if value.is_empty() || value.len() > 64 || value.starts_with('-') {
        return None;
    }
    let mut pieces = value.split('.');
    let whole = pieces.next()?;
    let fraction = pieces.next();
    if pieces.next().is_some() || whole.is_empty() || !whole.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let fraction = fraction.unwrap_or("");
    if (value.contains('.') && fraction.is_empty())
        || fraction.len() > maximum_fraction_digits
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let scale = 10_u128.checked_pow(fraction.len() as u32)?;
    let whole = whole.parse::<u128>().ok()?.checked_mul(scale)?;
    let fractional = if fraction.is_empty() { 0 } else { fraction.parse::<u128>().ok()? };
    Some((whole.checked_add(fractional)?, fraction.len() as u32))
}

fn zar_and_rate_to_piconero(amount_zar: &str, rate_xmr_per_zar: &str) -> Result<u64, &'static str> {
    let (zar_scaled, zar_scale) = parse_decimal(amount_zar, 2).ok_or("invalid amount_zar")?;
    let zar_cents = match zar_scale {
        0 => zar_scaled.checked_mul(100),
        1 => zar_scaled.checked_mul(10),
        2 => Some(zar_scaled),
        _ => None,
    }
    .ok_or("amount_zar is outside the supported range")?;
    if zar_cents == 0 {
        return Err("amount_zar must be positive");
    }

    let (rate_scaled, rate_scale) =
        parse_decimal(rate_xmr_per_zar, 18).ok_or("invalid rate_xmr_per_zar")?;
    if rate_scaled == 0 {
        return Err("rate_xmr_per_zar must be positive");
    }
    let rate_denominator = 10_u128
        .checked_pow(rate_scale)
        .ok_or("rate_xmr_per_zar is outside the supported range")?;
    let numerator = zar_cents
        .checked_mul(rate_scaled)
        .and_then(|value| value.checked_mul(1_000_000_000_000))
        .ok_or("payment amount is outside the supported range")?;
    let denominator = rate_denominator
        .checked_mul(100)
        .ok_or("rate_xmr_per_zar is outside the supported range")?;
    let rounded = numerator
        .checked_add(denominator / 2)
        .ok_or("payment amount is outside the supported range")?
        / denominator;
    if rounded == 0 {
        return Err("payment amount rounds to less than one piconero");
    }
    u64::try_from(rounded).map_err(|_| "payment amount is outside the supported range")
}

fn format_piconero_as_xmr(amount_piconero: u64) -> String {
    format!(
        "{}.{:012}",
        amount_piconero / 1_000_000_000_000,
        amount_piconero % 1_000_000_000_000
    )
}

fn generate_subaddress() -> String {
    // Mock subaddress — real impl uses acceptxmr + monerod RPC.
    let hex = Uuid::new_v4().to_string().replace('-', "");
    format!("8{:0<94}", hex)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: &'static str,
}

impl ApiError {
    fn unauthorized(message: &'static str) -> Self {
        Self { status: StatusCode::UNAUTHORIZED, message }
    }
    fn not_found(message: &'static str) -> Self {
        Self { status: StatusCode::NOT_FOUND, message }
    }
    fn bad_request(message: &'static str) -> Self {
        Self { status: StatusCode::BAD_REQUEST, message }
    }
    fn conflict(message: &'static str) -> Self {
        Self { status: StatusCode::CONFLICT, message }
    }
    fn unavailable(message: &'static str) -> Self {
        Self { status: StatusCode::SERVICE_UNAVAILABLE, message }
    }
    fn bad_gateway(message: &'static str) -> Self {
        Self { status: StatusCode::BAD_GATEWAY, message }
    }
    fn internal(message: &'static str) -> Self {
        Self { status: StatusCode::INTERNAL_SERVER_ERROR, message }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(serde_json::json!({ "error": self.message }))).into_response()
    }
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_decimal_zar_rate_to_piconero_without_float_rounding() {
        assert_eq!(
            zar_and_rate_to_piconero("150.00", "0.00012345").unwrap(),
            18_517_500_000
        );
        assert_eq!(format_piconero_as_xmr(18_517_500_000), "0.018517500000");
    }

    #[test]
    fn rejects_invalid_and_unrepresentable_payment_amounts() {
        assert!(zar_and_rate_to_piconero("1.001", "0.1").is_err());
        assert!(zar_and_rate_to_piconero("1", "1e-8").is_err());
        assert!(zar_and_rate_to_piconero("0", "0.1").is_err());
        assert!(zar_and_rate_to_piconero("100", "0").is_err());
        assert!(zar_and_rate_to_piconero("999999999999999999999", "1").is_err());
    }

    #[test]
    fn callback_model_has_no_caller_selected_runner_route() {
        let callback: PaymentCallback = serde_json::from_str(
            r#"{"order_id":"123e4567-e89b-42d3-a456-426614174000","subaddress":"8abc","txid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","amount_piconero":"100","confirmations":3,"confirmed_at":1,"runner_onion_hash":"attacker-selected"}"#,
        )
        .unwrap();
        assert_eq!(callback.order_id, "123e4567-e89b-42d3-a456-426614174000");
    }

    #[test]
    fn relay_url_must_be_a_non_onion_origin() {
        assert!(validate_relay_http_url("http://relay.internal:3000").is_ok());
        assert!(validate_relay_http_url("http://relay.example.onion").is_err());
        assert!(validate_relay_http_url("https://relay.example.com/path").is_err());
    }

    #[test]
    fn encrypted_notifications_are_disabled_unless_explicitly_enabled() {
        assert!(!parse_notifications_enabled(None).unwrap());
        assert!(!parse_notifications_enabled(Some("false")).unwrap());
        assert!(parse_notifications_enabled(Some("true")).unwrap());
        assert!(parse_notifications_enabled(Some("yes")).is_err());
    }

    #[test]
    fn disabled_notifications_do_not_load_identity_or_relay_configuration() {
        let state = AppState::notifications_disabled();
        assert!(matches!(state.notifications, NotificationConfig::Disabled));
    }

    #[test]
    fn monitor_nonce_is_single_use_with_a_bounded_replay_window() {
        let cache = Mutex::new(HashMap::new());
        assert!(record_nonce(&cache, "nonce_1234567890abcdef", 1000));
        assert!(!record_nonce(&cache, "nonce_1234567890abcdef", 1001));
        assert!(record_nonce(&cache, "nonce_1234567890abcdef", 1601));
    }
}
