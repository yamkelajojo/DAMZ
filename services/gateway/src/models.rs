//! DAMZ Gateway — Data models

use serde::Serialize;

/// Payment status enum
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum PaymentStatus {
    Pending,
    Confirmed,
    Expired,
}

impl std::fmt::Display for PaymentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentStatus::Pending => write!(f, "pending"),
            PaymentStatus::Confirmed => write!(f, "confirmed"),
            PaymentStatus::Expired => write!(f, "expired"),
        }
    }
}

/// Internal payment record
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PaymentRecord {
    pub id: String,
    pub order_id: String,
    pub runner_did: String,
    pub runner_onion_hash: String,
    pub notification_event_id: String,
    pub notification_issued_at: Option<i64>,
    pub notification_confirmations: Option<u64>,
    pub subaddress: String,
    pub amount_piconero: u64,
    pub expires_at: i64,
    pub status: PaymentStatus,
    pub amount_received_piconero: u64,
    pub confirmations: u64,
    pub txid: Option<String>,
    pub created_at: i64,
}
