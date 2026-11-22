//! DAMZ Relay — discardable Tor-hidden blob relay.
//!
//! Stores encrypted blobs in bounded in-memory queues with TTL. A recipient
//! polls by the hash of its Tor public key and acknowledges only after handling
//! the blob, so interrupted delivery can be retried safely.

use std::{
    collections::{HashMap, VecDeque},
    net::SocketAddr,
    str::FromStr,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{header::HeaderMap, HeaderName, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use parking_lot::RwLock;
use serde::Serialize;
use tokio::{net::TcpListener, signal, time::interval};
use tracing::info;
use uuid::Uuid;

const DEFAULT_PORT: u16 = 3000;
const DEFAULT_MAX_BLOBS: usize = 10_000;
const DEFAULT_MAX_BLOBS_PER_RECIPIENT: usize = 1_000;
const DEFAULT_MAX_BLOB_SIZE: usize = 64 * 1024;
const DEFAULT_MAX_TOTAL_BYTES: usize = 256 * 1024 * 1024;
const DEFAULT_MAX_TTL_SECONDS: u64 = 7 * 24 * 60 * 60;
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Clone, Copy)]
struct Limits {
    max_blobs: usize,
    max_blobs_per_recipient: usize,
    max_blob_size: usize,
    max_total_bytes: usize,
    max_ttl_seconds: u64,
}

#[derive(Clone)]
struct AppState {
    store: Arc<RwLock<RelayStore>>,
    limits: Limits,
}

#[derive(Default)]
struct RelayStore {
    blobs: HashMap<Uuid, BlobEntry>,
    recipients: HashMap<String, VecDeque<Uuid>>,
    total_bytes: usize,
}

struct BlobEntry {
    recipient_hash: String,
    data: Vec<u8>,
    expires_at: Instant,
}

#[derive(Debug, PartialEq, Eq)]
enum StoreError {
    GlobalBlobLimit,
    RecipientBlobLimit,
    BlobTooLarge,
    ByteLimit,
}

impl StoreError {
    fn response(self) -> Response {
        let message = match self {
            Self::GlobalBlobLimit => "relay blob queue full",
            Self::RecipientBlobLimit => "recipient queue full",
            Self::BlobTooLarge => "blob exceeds configured size limit",
            Self::ByteLimit => "relay memory limit reached",
        };
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse { error: message }),
        )
            .into_response()
    }
}

#[derive(Serialize)]
struct StoreResponse {
    blob_id: Uuid,
    expires_at: i64,
}

#[derive(Serialize)]
struct InboxItemResponse {
    blob_id: Uuid,
    payload_base64: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    blobs_in_memory: usize,
    bytes_in_memory: usize,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: &'static str,
}

impl RelayStore {
    fn insert(
        &mut self,
        recipient_hash: String,
        data: Vec<u8>,
        expires_at: Instant,
        limits: Limits,
    ) -> Result<Uuid, StoreError> {
        if data.len() > limits.max_blob_size {
            return Err(StoreError::BlobTooLarge);
        }
        if self.blobs.len() >= limits.max_blobs {
            return Err(StoreError::GlobalBlobLimit);
        }
        if self
            .recipients
            .get(&recipient_hash)
            .map_or(0, VecDeque::len)
            >= limits.max_blobs_per_recipient
        {
            return Err(StoreError::RecipientBlobLimit);
        }
        if self.total_bytes.saturating_add(data.len()) > limits.max_total_bytes {
            return Err(StoreError::ByteLimit);
        }

        let blob_id = Uuid::new_v4();
        let recipient_queue = self.recipients.entry(recipient_hash.clone()).or_default();
        recipient_queue.push_back(blob_id);
        self.total_bytes += data.len();
        self.blobs.insert(
            blob_id,
            BlobEntry {
                recipient_hash,
                data,
                expires_at,
            },
        );
        Ok(blob_id)
    }

    fn remove(&mut self, blob_id: &Uuid) -> Option<BlobEntry> {
        let entry = self.blobs.remove(blob_id)?;
        self.total_bytes = self.total_bytes.saturating_sub(entry.data.len());

        let remove_queue = if let Some(queue) = self.recipients.get_mut(&entry.recipient_hash) {
            queue.retain(|queued_id| queued_id != blob_id);
            queue.is_empty()
        } else {
            false
        };
        if remove_queue {
            self.recipients.remove(&entry.recipient_hash);
        }
        Some(entry)
    }

    fn take_by_id(&mut self, blob_id: &Uuid, now: Instant) -> TakeResult {
        match self.remove(blob_id) {
            None => TakeResult::Missing,
            Some(entry) if entry.expires_at <= now => TakeResult::Expired,
            Some(entry) => TakeResult::Found(entry.data),
        }
    }

    fn peek_next_for_recipient(
        &mut self,
        recipient_hash: &str,
        now: Instant,
    ) -> Option<(Uuid, Vec<u8>)> {
        loop {
            let blob_id = *self.recipients.get(recipient_hash)?.front()?;
            let Some(expires_at) = self.blobs.get(&blob_id).map(|entry| entry.expires_at) else {
                // Keep the queue consistent if an entry was removed through a
                // different path before this recipient was polled.
                let remove_queue = if let Some(queue) = self.recipients.get_mut(recipient_hash) {
                    queue.pop_front();
                    queue.is_empty()
                } else {
                    false
                };
                if remove_queue {
                    self.recipients.remove(recipient_hash);
                }
                continue;
            };
            if expires_at <= now {
                self.remove(&blob_id);
                continue;
            }
            let payload = self.blobs.get(&blob_id)?.data.clone();
            return Some((blob_id, payload));
        }
    }

    fn acknowledge(&mut self, recipient_hash: &str, blob_id: &Uuid) -> bool {
        if self
            .blobs
            .get(blob_id)
            .is_some_and(|entry| entry.recipient_hash == recipient_hash)
        {
            self.remove(blob_id);
            true
        } else {
            false
        }
    }

    fn remove_expired(&mut self, now: Instant) -> usize {
        let expired_ids: Vec<Uuid> = self
            .blobs
            .iter()
            .filter_map(|(id, entry)| (entry.expires_at <= now).then_some(*id))
            .collect();
        let removed = expired_ids.len();
        for id in expired_ids {
            self.remove(&id);
        }
        removed
    }
}

enum TakeResult {
    Missing,
    Expired,
    Found(Vec<u8>),
}

fn validate_recipient_hash(hash: &str) -> Result<String, &'static str> {
    if hash.len() != 64 || !hash.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("recipient hash must be 64 hexadecimal characters");
    }
    Ok(hash.to_ascii_lowercase())
}

fn extract_ttl(headers: &HeaderMap, max_ttl_seconds: u64) -> Result<u64, &'static str> {
    let header_name = HeaderName::from_static("x-expiry");
    let raw = headers
        .get(header_name)
        .ok_or("missing X-Expiry header")?
        .to_str()
        .map_err(|_| "X-Expiry header is not valid UTF-8")?;
    let ttl = raw
        .parse::<u64>()
        .map_err(|_| "X-Expiry must be a positive integer")?;
    if ttl == 0 || ttl > max_ttl_seconds {
        return Err("X-Expiry is outside the allowed range");
    }
    Ok(ttl)
}

fn bad_request(message: &'static str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse { error: message }),
    )
        .into_response()
}

fn blob_response(data: Vec<u8>) -> Response {
    (
        StatusCode::OK,
        [("content-type", "application/octet-stream")],
        data,
    )
        .into_response()
}

async fn store_blob(
    State(state): State<AppState>,
    Path(recipient_hash): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let recipient_hash = match validate_recipient_hash(&recipient_hash) {
        Ok(hash) => hash,
        Err(error) => return bad_request(error),
    };
    let ttl = match extract_ttl(&headers, state.limits.max_ttl_seconds) {
        Ok(ttl) => ttl,
        Err(error) => return bad_request(error),
    };
    let ttl_seconds = match i64::try_from(ttl) {
        Ok(ttl) => ttl,
        Err(_) => return bad_request("X-Expiry is outside the allowed range"),
    };
    let Some(expires_epoch) = time::OffsetDateTime::now_utc()
        .unix_timestamp()
        .checked_add(ttl_seconds)
    else {
        return bad_request("X-Expiry is outside the allowed range");
    };
    if body.len() > state.limits.max_blob_size {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(ErrorResponse {
                error: "blob exceeds configured size limit",
            }),
        )
            .into_response();
    }
    let Some(expires_at) = Instant::now().checked_add(Duration::from_secs(ttl)) else {
        return bad_request("X-Expiry is outside the allowed range");
    };

    let blob_id =
        match state
            .store
            .write()
            .insert(recipient_hash, body.to_vec(), expires_at, state.limits)
        {
            Ok(id) => id,
            Err(error) => return error.response(),
        };

    let response = StoreResponse {
        blob_id,
        expires_at: expires_epoch,
    };
    (StatusCode::ACCEPTED, Json(response)).into_response()
}

async fn retrieve_blob(State(state): State<AppState>, Path(blob_id): Path<String>) -> Response {
    let blob_id = match Uuid::parse_str(&blob_id) {
        Ok(id) => id,
        Err(_) => return bad_request("blob id must be a UUID"),
    };
    match state.store.write().take_by_id(&blob_id, Instant::now()) {
        TakeResult::Missing => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "blob not found or already retrieved",
            }),
        )
            .into_response(),
        TakeResult::Expired => (
            StatusCode::GONE,
            Json(ErrorResponse {
                error: "blob expired",
            }),
        )
            .into_response(),
        TakeResult::Found(data) => blob_response(data),
    }
}

async fn retrieve_next_for_recipient(
    State(state): State<AppState>,
    Path(recipient_hash): Path<String>,
) -> Response {
    let recipient_hash = match validate_recipient_hash(&recipient_hash) {
        Ok(hash) => hash,
        Err(error) => return bad_request(error),
    };
    match state
        .store
        .write()
        .peek_next_for_recipient(&recipient_hash, Instant::now())
    {
        Some((blob_id, data)) => Json(InboxItemResponse {
            blob_id,
            payload_base64: BASE64_STANDARD.encode(data),
        })
        .into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

async fn acknowledge_blob(
    State(state): State<AppState>,
    Path((recipient_hash, blob_id)): Path<(String, String)>,
) -> Response {
    let recipient_hash = match validate_recipient_hash(&recipient_hash) {
        Ok(hash) => hash,
        Err(error) => return bad_request(error),
    };
    let blob_id = match Uuid::parse_str(&blob_id) {
        Ok(id) => id,
        Err(_) => return bad_request("blob id must be a UUID"),
    };

    // Acknowledgements are idempotent and reveal no information about whether
    // a blob existed or belonged to this recipient.
    state
        .store
        .write()
        .acknowledge(&recipient_hash, &blob_id);
    StatusCode::NO_CONTENT.into_response()
}

async fn health(State(state): State<AppState>) -> Response {
    let store = state.store.read();
    Json(HealthResponse {
        status: "ok",
        blobs_in_memory: store.blobs.len(),
        bytes_in_memory: store.total_bytes,
    })
    .into_response()
}

async fn sweep_task(state: AppState) {
    let mut ticker = interval(SWEEP_INTERVAL);
    loop {
        ticker.tick().await;
        state.store.write().remove_expired(Instant::now());
    }
}

fn router(state: AppState) -> Router {
    let max_blob_size = state.limits.max_blob_size;
    Router::new()
        .route("/blob/:blob_ref", get(retrieve_blob).put(store_blob))
        .route("/inbox/:recipient_onion_hash", get(retrieve_next_for_recipient))
        .route(
            "/inbox/:recipient_onion_hash/ack/:blob_id",
            post(acknowledge_blob),
        )
        .route("/health", get(health))
        .layer(DefaultBodyLimit::max(max_blob_size))
        .with_state(state)
}

fn parse_env<T>(name: &str, default: T) -> Result<T>
where
    T: FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match std::env::var(name) {
        Ok(value) => value
            .parse::<T>()
            .with_context(|| format!("invalid {name} value")),
        Err(std::env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error).with_context(|| format!("failed to read {name}")),
    }
}

fn load_limits() -> Result<(u16, Limits)> {
    let port = parse_env("RELAY_PORT", DEFAULT_PORT)?;
    let limits = Limits {
        max_blobs: parse_env("MAX_BLOBS", DEFAULT_MAX_BLOBS)?,
        max_blobs_per_recipient: parse_env(
            "MAX_BLOBS_PER_RECIPIENT",
            DEFAULT_MAX_BLOBS_PER_RECIPIENT,
        )?,
        max_blob_size: parse_env("MAX_BLOB_SIZE", DEFAULT_MAX_BLOB_SIZE)?,
        max_total_bytes: parse_env("MAX_TOTAL_BYTES", DEFAULT_MAX_TOTAL_BYTES)?,
        max_ttl_seconds: parse_env("MAX_TTL_SECONDS", DEFAULT_MAX_TTL_SECONDS)?,
    };
    if port == 0
        || limits.max_blobs == 0
        || limits.max_blobs_per_recipient == 0
        || limits.max_blob_size == 0
        || limits.max_total_bytes == 0
        || limits.max_ttl_seconds == 0
    {
        anyhow::bail!("relay port and resource limits must be positive");
    }
    Ok((port, limits))
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,damz_relay=info".into()),
        )
        .init();

    let (port, limits) = load_limits()?;
    let state = AppState {
        store: Arc::new(RwLock::new(RelayStore::default())),
        limits,
    };
    tokio::spawn(sweep_task(state.clone()));

    let app = router(state);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await?;
    info!(port, "damz-relay starting");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    info!("damz-relay shut down");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.ok();
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("received Ctrl+C, shutting down"),
        _ = terminate => info!("received SIGTERM, shutting down"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use serde::Deserialize;
    use tower::ServiceExt;

    const RECIPIENT_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const RECIPIENT_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn test_state(limits: Limits) -> AppState {
        AppState {
            store: Arc::new(RwLock::new(RelayStore::default())),
            limits,
        }
    }

    fn limits() -> Limits {
        Limits {
            max_blobs: 8,
            max_blobs_per_recipient: 4,
            max_blob_size: 32,
            max_total_bytes: 128,
            max_ttl_seconds: 60,
        }
    }

    #[derive(Deserialize)]
    struct Stored {
        blob_id: Uuid,
    }

    async fn put_blob(app: Router, recipient: &str, payload: &'static str) -> (Router, Uuid) {
        let request = Request::builder()
            .method("PUT")
            .uri(format!("/blob/{recipient}"))
            .header("X-Expiry", "60")
            .body(Body::from(payload))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let stored: Stored = serde_json::from_slice(&bytes).unwrap();
        (app, stored.blob_id)
    }

    fn get_request(uri: String) -> Request<Body> {
        Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn recipient_inbox_repeats_until_acknowledged_then_advances_fifo() {
        let app = router(test_state(limits()));
        let (app, blob_a1) = put_blob(app, RECIPIENT_A, "message-a1").await;
        let (app, blob_a2) = put_blob(app, RECIPIENT_A, "message-a2").await;
        let (app, blob_b) = put_blob(app, RECIPIENT_B, "message-b").await;

        let response = app
            .clone()
            .oneshot(get_request(format!("/inbox/{RECIPIENT_A}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let first: serde_json::Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX).await.unwrap(),
        )
        .unwrap();
        assert_eq!(first["blob_id"], blob_a1.to_string());
        let first_payload = BASE64_STANDARD
            .decode(first["payload_base64"].as_str().unwrap())
            .unwrap();
        assert_eq!(first_payload.as_slice(), b"message-a1");

        let response = app
            .clone()
            .oneshot(get_request(format!("/inbox/{RECIPIENT_A}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let repeated: serde_json::Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX).await.unwrap(),
        )
        .unwrap();
        assert_eq!(repeated["blob_id"], blob_a1.to_string());

        let ack = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/inbox/{RECIPIENT_A}/ack/{blob_a1}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ack.status(), StatusCode::NO_CONTENT);

        let response = app
            .clone()
            .oneshot(get_request(format!("/inbox/{RECIPIENT_A}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let second: serde_json::Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX).await.unwrap(),
        )
        .unwrap();
        assert_eq!(second["blob_id"], blob_a2.to_string());

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/inbox/{RECIPIENT_A}/ack/{blob_a2}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .clone()
            .oneshot(get_request(format!("/inbox/{RECIPIENT_A}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .oneshot(get_request(format!("/inbox/{RECIPIENT_B}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let other: serde_json::Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX).await.unwrap(),
        )
        .unwrap();
        assert_eq!(other["blob_id"], blob_b.to_string());
    }

    #[tokio::test]
    async fn acknowledgement_only_removes_a_blob_from_its_matching_recipient() {
        let app = router(test_state(limits()));
        let (app, blob_id) = put_blob(app, RECIPIENT_A, "message-a").await;

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/inbox/{RECIPIENT_B}/ack/{blob_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .oneshot(get_request(format!("/inbox/{RECIPIENT_A}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn direct_retrieval_removes_blob_from_recipient_queue() {
        let app = router(test_state(limits()));
        let (app, blob_id) = put_blob(app, RECIPIENT_A, "direct").await;

        let response = app
            .clone()
            .oneshot(get_request(format!("/blob/{blob_id}")))
            .await
            .unwrap();
        assert_eq!(
            String::from_utf8(
                to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap()
                    .to_vec()
            )
            .unwrap(),
            "direct"
        );

        let response = app
            .oneshot(get_request(format!("/inbox/{RECIPIENT_A}")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[test]
    fn capacity_is_enforced_atomically_and_expiry_releases_it() {
        let limits = Limits {
            max_blobs: 1,
            max_blobs_per_recipient: 1,
            ..limits()
        };
        let state = test_state(limits);
        let state_for_writer = state.clone();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut writers = Vec::new();
        for _ in 0..2 {
            let state = state_for_writer.clone();
            let barrier = barrier.clone();
            writers.push(std::thread::spawn(move || {
                barrier.wait();
                state.store.write().insert(
                    RECIPIENT_A.to_string(),
                    b"x".to_vec(),
                    Instant::now() + Duration::from_secs(30),
                    limits,
                )
            }));
        }
        barrier.wait();
        let successes = writers
            .into_iter()
            .map(|writer| writer.join().unwrap().is_ok())
            .filter(|success| *success)
            .count();
        assert_eq!(successes, 1);
        assert_eq!(state.store.read().blobs.len(), 1);
        assert_eq!(
            state
                .store
                .write()
                .remove_expired(Instant::now() + Duration::from_secs(31)),
            1
        );
        assert_eq!(state.store.read().total_bytes, 0);
    }

    #[test]
    fn recipient_and_total_byte_limits_are_enforced() {
        let limits = Limits {
            max_blobs: 4,
            max_blobs_per_recipient: 1,
            max_blob_size: 4,
            max_total_bytes: 3,
            ..limits()
        };
        let mut store = RelayStore::default();
        let expiry = Instant::now() + Duration::from_secs(30);

        store
            .insert(RECIPIENT_A.to_string(), b"ab".to_vec(), expiry, limits)
            .unwrap();
        assert_eq!(
            store.insert(RECIPIENT_A.to_string(), b"c".to_vec(), expiry, limits),
            Err(StoreError::RecipientBlobLimit)
        );
        assert_eq!(
            store.insert(RECIPIENT_B.to_string(), b"cd".to_vec(), expiry, limits),
            Err(StoreError::ByteLimit)
        );
        assert_eq!(store.blobs.len(), 1);
        assert_eq!(store.total_bytes, 2);
    }

    #[tokio::test]
    async fn invalid_recipient_and_oversized_blob_are_rejected() {
        let app = router(test_state(limits()));
        let invalid = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/blob/not-a-recipient")
                    .header("X-Expiry", "60")
                    .body(Body::from("x"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

        let oversized = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/blob/{RECIPIENT_A}"))
                    .header("X-Expiry", "60")
                    .body(Body::from(vec![0; 33]))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(oversized.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn validates_ttl_upper_bound() {
        let mut headers = HeaderMap::new();
        headers.insert("x-expiry", "61".parse().unwrap());
        assert_eq!(
            extract_ttl(&headers, 60),
            Err("X-Expiry is outside the allowed range")
        );
    }
}
