use anyhow::{Context, Result};
use damz_gateway::server;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,damz_gateway=debug".into()),
        )
        .init();

    server::run().await.context("Gateway service failed")
}
