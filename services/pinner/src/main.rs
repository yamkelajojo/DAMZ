//! DAMZ Pinner — IPFS pinning service for proof bundles
//!
//! Uses Helia/libp2p. Tor-hidden service.
//! See services/pinner/SPEC.md (TBD) for full specification.

use std::net::SocketAddr;

use anyhow::Result;
use axum::{routing::get, Router};
use tokio::net::TcpListener;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,damz_pinner=debug".into()),
        )
        .init();

    let port = std::env::var("PINNER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3003);

    let app = Router::new()
        .route("/health", get(|| async { "ok" }));

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await?;

    info!(port = port, "damz-pinner starting on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("damz-pinner shut down");
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.ok();
}