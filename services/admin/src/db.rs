//! DAMZ Admin — Database initialization and bounded-scope check
//!
//! Creates the six Admin tables and verifies no order/message/proof data leaks.

use anyhow::{Context, Result};
use sqlx::sqlite::SqlitePool;

pub type Pool = SqlitePool;

/// Initialize the Admin database schema (six tables only).
///
/// These tables are separate from the 19-table client-side WatermelonDB schema.
/// Holds zero rows of order, message, or proof data beyond what disputes
/// explicitly allows (opaque order_id, proof_cid, proof_key).
pub async fn init_database(pool: &Pool) -> Result<()> {
    // admin_identity — exactly one admin
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS admin_identity (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            did           TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .context("create admin_identity table")?;

    // runner_registry — pre-created by admin, claimed by runner
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS runner_registry (
            id             TEXT PRIMARY KEY,
            runner_did     TEXT NOT NULL,
            display_name   TEXT,
            onion_address  TEXT NOT NULL,
            approved_at    INTEGER,
            banned_at      INTEGER,
            ban_reason     TEXT,
            last_active_at INTEGER
        )
        "#,
    )
    .execute(pool)
    .await
    .context("create runner_registry table")?;

    // disputes — customer-submitted, admin-adjudicated
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS disputes (
            id            TEXT PRIMARY KEY,
            order_id      TEXT NOT NULL,
            customer_did  TEXT NOT NULL,
            runner_did    TEXT NOT NULL,
            reason        TEXT NOT NULL CHECK (reason IN ('non_delivery','wrong_item','other')),
            proof_cid     TEXT,
            proof_key     TEXT,
            status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
            created_at    INTEGER NOT NULL,
            resolved_at   INTEGER,
            admin_notes   TEXT
        )
        "#,
    )
    .execute(pool)
    .await
    .context("create disputes table")?;

    // strikes — customer penalties
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS strikes (
            id         TEXT PRIMARY KEY,
            subject_did TEXT NOT NULL,
            reason     TEXT NOT NULL CHECK (reason IN ('no_show','false_claim','abusive')),
            issued_at  INTEGER NOT NULL,
            revoked_at INTEGER,
            notes      TEXT
        )
        "#,
    )
    .execute(pool)
    .await
    .context("create strikes table")?;

    // platform_settings — key-value
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS platform_settings (
            id         TEXT PRIMARY KEY,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .context("create platform_settings table")?;

    // wipe_pending — Admin-only, target-bound, expiring app-data wipe jobs
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS wipe_pending (
            id                 TEXT PRIMARY KEY,
            target_did         TEXT NOT NULL,
            target_app         TEXT NOT NULL CHECK (target_app IN ('customer', 'runner')),
            scope              TEXT NOT NULL DEFAULT 'app_data' CHECK (scope = 'app_data'),
            reason_code        TEXT NOT NULL CHECK (reason_code IN ('device_lost','device_retired','security_incident')),
            nonce              TEXT NOT NULL UNIQUE,
            issued_at          INTEGER NOT NULL,
            expires_at         INTEGER NOT NULL,
            status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','completed','cancelled','expired')),
            accepted_at        INTEGER,
            completed_at       INTEGER,
            requested_by       TEXT NOT NULL,
            command_signature  TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .context("create wipe_pending table")?;

    // Indexes
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_wipe_pending_target ON wipe_pending(target_did, target_app, status, expires_at)",
    )
    .execute(pool)
    .await
    .context("create wipe_pending target index")?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_wipe_per_target ON wipe_pending(target_did, target_app) WHERE status IN ('pending','accepted')",
    )
    .execute(pool)
    .await
    .context("create unique active wipe index")?;

    Ok(())
}

/// Bounded-scope startup check.
///
/// Fails fast if the Admin database contains any table with order/message/proof
/// columns outside the narrowly permitted dispute exceptions:
///   - disputes.order_id (opaque, no FK)
///   - disputes.proof_cid (opaque, no FK)
///   - disputes.proof_key (cleared on close)
///
/// wipe_pending.target_did is permitted (pseudonymous app-installation target only).
pub async fn enforce_bounded_scope(pool: &Pool) -> Result<()> {
    let tables: Vec<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type='table'",
    )
    .fetch_all(pool)
    .await
    .context("list tables")?;

    for (table_name,) in tables {
        let cols: Vec<(String,)> = sqlx::query_as(&format!("PRAGMA table_info({})", table_name))
            .fetch_all(pool)
            .await
            .with_context(|| format!("PRAGMA table_info({})", table_name))?;

        for (col_name,) in cols {
            let lower = col_name.to_lowercase();
            if lower.contains("order_id")
                || lower.contains("message_id")
                || lower.starts_with("proof_")
            {
                // Permitted exceptions in disputes table
                if table_name == "disputes"
                    && (col_name == "order_id"
                        || col_name == "proof_cid"
                        || col_name == "proof_key")
                {
                    continue;
                }
                // wipe_pending.target_did is NOT an order/message/proof column
                if table_name == "wipe_pending" && col_name == "target_did" {
                    continue;
                }
                return Err(anyhow::anyhow!(
                    "BoundedScopeViolation: table '{}' has forbidden column '{}' — Admin DB must hold zero order/message/proof data",
                    table_name, col_name
                ));
            }
        }
    }

    Ok(())
}