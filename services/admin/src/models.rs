//! DAMZ Admin — Database row models
//!
//! These mirror the six Admin tables for use with sqlx query_as.

use serde::Serialize;

/// runner_registry row
#[derive(sqlx::FromRow, Serialize, Debug)]
pub struct RunnerRow {
    pub id: String,
    pub runner_did: String,
    pub display_name: Option<String>,
    pub onion_address: String,
    pub approved_at: Option<i64>,
    pub banned_at: Option<i64>,
    pub ban_reason: Option<String>,
    pub last_active_at: Option<i64>,
}

/// disputes row
#[derive(sqlx::FromRow, Serialize, Debug)]
pub struct DisputeRow {
    pub id: String,
    pub order_id: String,
    pub customer_did: String,
    pub runner_did: String,
    pub reason: String,
    pub proof_cid: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
    pub admin_notes: Option<String>,
}

/// strikes row
#[derive(sqlx::FromRow, Serialize, Debug)]
pub struct StrikeRow {
    pub id: String,
    pub subject_did: String,
    pub reason: String,
    pub issued_at: i64,
    pub revoked_at: Option<i64>,
    pub notes: Option<String>,
}

/// platform_settings row
#[derive(sqlx::FromRow, Serialize, Debug)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

/// wipe_pending row
#[derive(sqlx::FromRow, Serialize, Debug)]
pub struct WipeRow {
    pub id: String,
    pub target_did: String,
    pub target_app: String,
    pub scope: String,
    pub reason_code: String,
    pub nonce: String,
    pub issued_at: i64,
    pub expires_at: i64,
    pub status: String,
    pub accepted_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub requested_by: String,
    pub command_signature: String,
}