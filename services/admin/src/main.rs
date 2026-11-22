//! DAMZ Admin Service — runner registry, strikes, disputes, wipe commands
//!
//! Single bounded, Tor-hidden service. Holds zero rows of order, message, or proof data.
//! See services/admin/SPEC.md for full specification.

use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use axum::{
    extract::{State},
    http::{header::HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use parking_lot::RwLock;
use serde::Deserialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use tokio::net::TcpListener;
use tracing::{error, info};
use uuid::Uuid;

use crate::auth::verify_did_signature;
use crate::db::{enforce_bounded_scope, init_database, Pool};
use crate::models::*;

mod auth;
mod db;
mod models;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct AppState {
    db: Pool,
    #[allow(dead_code)]
    nonce_cache: Arc<RwLock<HashMap<String, i64>>>, // nonce -> expiry timestamp
    #[allow(dead_code)]
    admin_did: String,
}

impl AppState {
    fn new(db: Pool, admin_did: String) -> Self {
        Self {
            db,
            nonce_cache: Arc::new(RwLock::new(HashMap::new())),
            admin_did,
        }
    }
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct DisputeSubmit {
    order_id: String,
    reason: String,
    proof_cid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProofKeyShare {
    proof_key: String,
}

#[derive(Debug, Deserialize)]
struct RunnerClaim {
    #[allow(dead_code)]
    runner_did: String,
    #[allow(dead_code)]
    display_name: Option<String>,
    #[allow(dead_code)]
    onion_address: String,
}

#[derive(Debug, Deserialize)]
struct WipeAck {
    status: String, // "accepted" | "completed"
    nonce: String,
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn unauthorized(message: &str) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.to_string(),
        }
    }
    fn forbidden(message: &str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.to_string(),
        }
    }
    fn not_found(message: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.to_string(),
        }
    }
    fn bad_request(message: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            axum::Json(serde_json::json!({"error": self.message})),
        )
            .into_response()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

fn authenticate_request(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<String, ApiError> {
    let did = headers
        .get("X-DAMZ-DID")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("missing X-DAMZ-DID"))?;

    let signature = headers
        .get("X-DAMZ-Signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("missing X-DAMZ-Signature"))?;

    let timestamp = headers
        .get("X-DAMZ-Timestamp")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok())
        .ok_or_else(|| ApiError::unauthorized("missing or invalid X-DAMZ-Timestamp"))?;

    let nonce = headers
        .get("X-DAMZ-Nonce")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("missing X-DAMZ-Nonce"))?;

    // Replay protection: timestamp within ±5 min
    let now = now_secs();
    if (now - timestamp).abs() > 300 {
        return Err(ApiError::unauthorized("timestamp outside ±5 min window"));
    }

    // Replay protection: nonce not seen recently
    let mut nonces = state.nonce_cache.write();
    if nonces.contains_key(nonce) {
        return Err(ApiError::unauthorized("nonce already used"));
    }
    nonces.insert(nonce.to_string(), now + 600); // 10 min TTL

    // Verify DID signature (empty body for sync endpoints)
    verify_did_signature(did, signature, timestamp, nonce, &[]).map_err(|e| {
        ApiError::unauthorized(&format!("signature verification failed: {}", e))
    })?;

    Ok(did.to_string())
}

fn authenticate_wipe_request(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<(String, String), ApiError> {
    let did = authenticate_request(headers, state)?;

    let app_role = headers
        .get("X-DAMZ-App")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("missing X-DAMZ-App for wipe route"))?;

    if app_role != "customer" && app_role != "runner" {
        return Err(ApiError::unauthorized("invalid X-DAMZ-App value"));
    }

    Ok((did, app_role.to_string()))
}

// ---------------------------------------------------------------------------
// Endpoints — all return Response directly (axum 0.7 handler requirement)
// ---------------------------------------------------------------------------

/// GET /sync/strikes?cursor=<n>&limit=<n>
async fn sync_strikes(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let _did = match authenticate_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };
    let cursor: i64 = params
        .get("cursor")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let limit: i64 = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    match sqlx::query_as::<_, StrikeRow>("SELECT id, subject_did, reason, issued_at, revoked_at, notes FROM strikes ORDER BY issued_at DESC LIMIT ? OFFSET ?")
        .bind(limit)
        .bind(cursor)
        .fetch_all(&state.db)
        .await
    {
        Ok(strikes) => {
            let has_more = strikes.len() as i64 == limit;
            let next_cursor = if has_more { Some(cursor + limit) } else { None };
            axum::Json(serde_json::json!({
                "data": strikes,
                "cursor": next_cursor,
                "has_more": has_more,
            }))
            .into_response()
        }
        Err(e) => {
            error!(error = %e, "fetch strikes failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// GET /sync/settings?cursor=<n>&limit=<n>
async fn sync_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let _did = match authenticate_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };
    let cursor: i64 = params
        .get("cursor")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let limit: i64 = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    match sqlx::query_as::<_, SettingRow>("SELECT key, value, updated_at FROM platform_settings ORDER BY updated_at DESC LIMIT ? OFFSET ?")
        .bind(limit)
        .bind(cursor)
        .fetch_all(&state.db)
        .await
    {
        Ok(settings) => {
            let has_more = settings.len() as i64 == limit;
            let next_cursor = if has_more { Some(cursor + limit) } else { None };
            axum::Json(serde_json::json!({
                "data": settings,
                "cursor": next_cursor,
                "has_more": has_more,
            }))
            .into_response()
        }
        Err(e) => {
            error!(error = %e, "fetch settings failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// GET /sync/directory?cursor=<n>&limit=<n>
async fn sync_directory(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let _did = match authenticate_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };
    let cursor: i64 = params
        .get("cursor")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let limit: i64 = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    match sqlx::query_as::<_, RunnerRow>("SELECT id, runner_did, display_name, onion_address, approved_at, banned_at, ban_reason, last_active_at FROM runner_registry WHERE banned_at IS NULL ORDER BY approved_at DESC LIMIT ? OFFSET ?")
        .bind(limit)
        .bind(cursor)
        .fetch_all(&state.db)
        .await
    {
        Ok(runners) => {
            let has_more = runners.len() as i64 == limit;
            let next_cursor = if has_more { Some(cursor + limit) } else { None };
            axum::Json(serde_json::json!({
                "data": runners,
                "cursor": next_cursor,
                "has_more": has_more,
            }))
            .into_response()
        }
        Err(e) => {
            error!(error = %e, "fetch runner directory failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// GET /sync/disputes?cursor=<n>&limit=<n>
async fn sync_disputes(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let did = match authenticate_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };
    let cursor: i64 = params
        .get("cursor")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let limit: i64 = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    match sqlx::query_as::<_, DisputeRow>("SELECT id, order_id, customer_did, runner_did, reason, proof_cid, status, created_at, resolved_at, admin_notes FROM disputes WHERE customer_did = ? OR runner_did = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .bind(&did)
        .bind(&did)
        .bind(limit)
        .bind(cursor)
        .fetch_all(&state.db)
        .await
    {
        Ok(disputes) => {
            let has_more = disputes.len() as i64 == limit;
            let next_cursor = if has_more { Some(cursor + limit) } else { None };
            axum::Json(serde_json::json!({
                "data": disputes,
                "cursor": next_cursor,
                "has_more": has_more,
            }))
            .into_response()
        }
        Err(e) => {
            error!(error = %e, "fetch disputes failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// GET /sync/wipe — at most one target-bound pending wipe command
async fn sync_wipe(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let (did, app_role) = match authenticate_wipe_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };

    let now = now_secs();

    match sqlx::query_as::<_, WipeRow>("SELECT id, target_did, target_app, scope, reason_code, nonce, issued_at, expires_at, status, accepted_at, completed_at, requested_by, command_signature FROM wipe_pending WHERE target_did = ? AND target_app = ? AND status = 'pending' AND expires_at > ? LIMIT 1")
        .bind(&did)
        .bind(&app_role)
        .bind(now)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(w)) => axum::Json(serde_json::json!({
            "id": w.id,
            "target_did": w.target_did,
            "target_app": w.target_app,
            "scope": w.scope,
            "issued_at": w.issued_at,
            "expires_at": w.expires_at,
            "nonce": w.nonce,
            "command_signature": w.command_signature,
        }))
        .into_response(),
        Ok(None) => axum::Json(serde_json::json!({
            "data": null,
            "cursor": null,
            "has_more": false,
        }))
        .into_response(),
        Err(e) => {
            error!(error = %e, "fetch pending wipe failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// POST /disputes — Customer submits draft dispute
async fn submit_dispute(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<DisputeSubmit>,
) -> Response {
    let did = match authenticate_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };
    let id = Uuid::new_v4().to_string();
    let now = now_secs();

    match sqlx::query("INSERT INTO disputes (id, order_id, customer_did, runner_did, reason, proof_cid, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)")
        .bind(&id)
        .bind(&payload.order_id)
        .bind(&did)
        .bind(&did)
        .bind(&payload.reason)
        .bind(&payload.proof_cid)
        .bind(now)
        .execute(&state.db)
        .await
    {
        Ok(_) => axum::Json(serde_json::json!({
            "id": id,
            "status": "open",
            "created_at": now,
        }))
        .into_response(),
        Err(e) => {
            error!(error = %e, "insert dispute failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// POST /disputes/{id}/proof-key — Customer shares proof key for admin review
async fn share_proof_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(dispute_id): axum::extract::Path<String>,
    axum::Json(payload): axum::Json<ProofKeyShare>,
) -> Response {
    let did = match authenticate_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };

    match sqlx::query_as::<_, DisputeRow>("SELECT id, order_id, customer_did, runner_did, reason, proof_cid, status, created_at, resolved_at, admin_notes FROM disputes WHERE id = ?")
        .bind(&dispute_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(dispute)) => {
            if dispute.customer_did != did {
                return ApiError::forbidden("not the dispute's customer").into_response();
            }
            if dispute.status != "open" {
                return ApiError::bad_request("dispute is not open").into_response();
            }

            match sqlx::query("UPDATE disputes SET proof_key = ? WHERE id = ?")
        .bind(&payload.proof_key)
        .bind(&dispute_id)
        .execute(&state.db)
        .await
            {
                Ok(_) => axum::Json(serde_json::json!({
                    "status": "ok",
                    "dispute_id": dispute_id,
                }))
                .into_response(),
                Err(e) => {
                    error!(error = %e, "update proof key failed");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Ok(None) => ApiError::not_found("dispute not found").into_response(),
        Err(e) => {
            error!(error = %e, "fetch dispute failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// POST /runners/claim — Runner claims pre-created registry entry
async fn claim_runner(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(_payload): axum::Json<RunnerClaim>,
) -> Response {
    let did = match authenticate_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };
    let now = now_secs();

    match sqlx::query("UPDATE runner_registry SET approved_at = ?, last_active_at = ? WHERE runner_did = ? AND id = ? AND approved_at IS NULL")
        .bind(now)
        .bind(now)
        .bind(&did)
        .bind(&did)
        .execute(&state.db)
        .await
    {
        Ok(_) => axum::Json(serde_json::json!({
            "status": "claimed",
            "runner_did": did,
        }))
        .into_response(),
        Err(e) => {
            error!(error = %e, "claim runner failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// GET /runners/me — Runner checks their registry status
async fn runner_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let did = match authenticate_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };

    match sqlx::query_as::<_, RunnerRow>("SELECT id, runner_did, display_name, onion_address, approved_at, banned_at, ban_reason, last_active_at FROM runner_registry WHERE id = ?")
        .bind(&did)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(r)) => axum::Json(serde_json::json!({
            "runner_did": r.runner_did,
            "display_name": r.display_name,
            "onion_address": r.onion_address,
            "approved_at": r.approved_at,
            "banned_at": r.banned_at,
            "ban_reason": r.ban_reason,
        }))
        .into_response(),
        Ok(None) => ApiError::not_found("runner not registered").into_response(),
        Err(e) => {
            error!(error = %e, "fetch runner failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// POST /sync/wipe/{id}/ack — Target reports accepted/completed for its own command
async fn wipe_ack(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(wipe_id): axum::extract::Path<String>,
    axum::Json(payload): axum::Json<WipeAck>,
) -> Response {
    let (did, app_role) = match authenticate_wipe_request(&headers, &state) {
        Ok(d) => d,
        Err(e) => return e.into_response(),
    };

    match sqlx::query_as::<_, WipeRow>("SELECT id, target_did, target_app, scope, reason_code, nonce, issued_at, expires_at, status, accepted_at, completed_at, requested_by, command_signature FROM wipe_pending WHERE id = ?")
        .bind(&wipe_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(wipe)) => {
            if wipe.target_did != did || wipe.target_app != app_role {
                return ApiError::forbidden("wipe command not for this target").into_response();
            }
            if wipe.nonce != payload.nonce {
                return ApiError::bad_request("nonce mismatch").into_response();
            }
            if wipe.status != "pending" && wipe.status != "accepted" {
                return ApiError::bad_request("wipe command not in ackable state").into_response();
            }

            let now = now_secs();
            let status = match payload.status.as_str() {
                "accepted" => {
                    if wipe.status == "accepted" {
                        return ApiError::bad_request("already accepted").into_response();
                    }
                    "accepted"
                }
                "completed" => {
                    if wipe.status == "completed" {
                        return ApiError::bad_request("already completed").into_response();
                    }
                    "completed"
                }
                _ => return ApiError::bad_request("invalid status").into_response(),
            };

            let column = match status {
                "accepted" => "accepted_at",
                "completed" => "completed_at",
                _ => return ApiError::bad_request("invalid status").into_response(),
            };

            match sqlx::query(&format!("UPDATE wipe_pending SET status = ?, {} = ? WHERE id = ?", column))
        .bind(status)
        .bind(now)
        .bind(&wipe_id)
        .execute(&state.db)
        .await
            {
                Ok(_) => axum::Json(serde_json::json!({
                    "status": status,
                    "nonce": wipe.nonce,
                }))
                .into_response(),
                Err(e) => {
                    error!(error = %e, "update wipe status failed");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Ok(None) => ApiError::not_found("wipe command not found").into_response(),
        Err(e) => {
            error!(error = %e, "fetch wipe command failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// GET /health
async fn health(State(state): State<AppState>) -> Response {
    match sqlx::query("SELECT 1").fetch_one(&state.db).await {
        Ok(_) => (StatusCode::OK, axum::Json(serde_json::json!({"status": "ok"}))).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, axum::Json(serde_json::json!({"status": "db_error"}))).into_response(),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

fn router(state: AppState) -> Router {
    Router::new()
        // Sync endpoints
        .route("/sync/strikes", get(sync_strikes))
        .route("/sync/settings", get(sync_settings))
        .route("/sync/directory", get(sync_directory))
        .route("/sync/disputes", get(sync_disputes))
        .route("/sync/wipe", get(sync_wipe))
        // Write endpoints
        .route("/disputes", post(submit_dispute))
        .route("/disputes/{id}/proof-key", post(share_proof_key))
        .route("/runners/claim", post(claim_runner))
        .route("/runners/me", get(runner_me))
        .route("/sync/wipe/{id}/ack", post(wipe_ack))
        // Health
        .route("/health", get(health))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,damz_admin=debug".into()),
        )
        .init();

    let port = std::env::var("ADMIN_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3002);

    let database_url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL required (e.g. sqlite:///var/lib/damz/admin.db)")?;

    let db_encryption_key = std::env::var("DB_ENCRYPTION_KEY")
        .context("DB_ENCRYPTION_KEY required (32-byte hex)")?;

    let admin_did = std::env::var("ADMIN_DID")
        .context("ADMIN_DID required")?;

    // Connect to database with SQLCipher key via PRAGMA
    let mut options = database_url
        .parse::<SqliteConnectOptions>()?
        .create_if_missing(true);

    options = options
        .pragma("key".to_string(), format!("x'{}'", db_encryption_key))
        .pragma("cipher".to_string(), "sqlcipher".to_string());

    let pool = SqlitePool::connect_with(options)
        .await
        .context("connect to database")?;

    // Initialize schema
    init_database(&pool).await.context("init database schema")?;

    // Bounded-scope startup check (fails fast if violated)
    enforce_bounded_scope(&pool)
        .await
        .context("bounded-scope check failed")?;

    info!("bounded-scope check passed — admin DB contains only permitted tables");

    let state = AppState::new(pool, admin_did);

    // Start nonce cache cleanup task (TTL 10 min)
    let nonce_cache = state.nonce_cache.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(600));
        loop {
            interval.tick().await;
            let now = now_secs();
            nonce_cache.write().retain(|_, expiry| *expiry > now);
        }
    });

    let app = router(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await?;

    info!(port = port, "damz-admin starting on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("damz-admin shut down");
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.ok();
}