//! High-performance WebSocket terminal proxy for binG
//! 
//! Handles 10K+ concurrent terminal connections without Node.js event-loop blocking.
//! Features:
//! - WebSocket upgrade and routing
//! - Per-connection JWT authentication
//! - Redis-backed session state
//! - Connection pooling and rate limiting
//! - Graceful shutdown

mod auth;
mod config;
mod connection;
mod metrics;
mod session;
mod redis_store;
mod router;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use tokio::net::TcpListener;
use tokio::signal;
use tracing::{info, warn, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::router::Router;

/// Main entry point
#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,terminal_proxy=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting Terminal Proxy v{}", env!("CARGO_PKG_VERSION"));
    info!("WebSocket terminal proxy for binG - handles 10K+ concurrent connections");

    // Load configuration
    let config = Config::from_env();
    info!("Configuration loaded: {} active, {} workers", 
          config.max_connections, config.worker_threads);

    // Initialize Redis connection pool
    let redis_store = redis_store::RedisStore::new(&config.redis_url).await?;
    info!("Connected to Redis: {}", config.redis_url);

    // Create shared router
    let router = Arc::new(Router::new(redis_store.clone(), config.clone()));
    
    // Initialize metrics
    metrics::start_metrics_server(config.metrics_port);

    // Start WebSocket server
    let addr: SocketAddr = config.listen_addr.parse()?;
    let listener = TcpListener::bind(&addr).await?;
    info!("WebSocket server listening on {}", addr);

    // Spawn worker tasks for connection handling
    let router_clone = router.clone();
    let handle_connections = async move {
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    let router = router_clone.clone();
                    tokio::spawn(async move {
                        if let Err(e) = connection::handle_connection(stream, addr, &router).await {
                            warn!("Connection error from {}: {}", addr, e);
                        }
                    });
                }
                Err(e) => {
                    error!("Failed to accept connection: {}", e);
                }
            }
        }
    };

    // Wait for shutdown signal
    tokio::spawn(handle_connections);
    
    info!("Terminal proxy running. Press Ctrl+C to stop.");
    
    match signal::ctrl_c().await {
        Ok(()) => {
            info!("Shutdown signal received");
        }
        Err(e) => {
            error!("Failed to listen for shutdown signal: {}", e);
        }
    }

    info!("Shutting down terminal proxy");
    Ok(())
}