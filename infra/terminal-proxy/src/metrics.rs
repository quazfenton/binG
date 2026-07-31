//! Metrics collection and reporting
//! 
//! Exposes Prometheus-compatible metrics on a separate port
//! for monitoring the terminal proxy at scale.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;
use std::collections::HashMap;
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::info;

/// Global metrics state
mod global {
    use super::*;
    
    pub static ACTIVE_CONNECTIONS: AtomicU64 = AtomicU64::new(0);
    pub static TOTAL_SESSIONS: AtomicU64 = AtomicU64::new(0);
    pub static AUTH_SUCCESS: AtomicU64 = AtomicU64::new(0);
    pub static AUTH_FAILURE: AtomicU64 = AtomicU64::new(0);
    pub static MESSAGES_RELAYED: AtomicU64 = AtomicU64::new(0);
    pub static ERRORS: AtomicU64 = AtomicU64::new(0);
    
    pub static USER_SESSIONS: RwLock<HashMap<String, u64>> = RwLock::new(HashMap::new());
}

/// Increment active connections
pub fn increment_connections() {
    global::ACTIVE_CONNECTIONS.fetch_add(1, Ordering::Relaxed);
}

/// Decrement active connections
pub fn decrement_connections() {
    global::ACTIVE_CONNECTIONS.fetch_sub(1, Ordering::Relaxed);
}

/// Increment total sessions created
pub fn increment_sessions(user_id: &str) {
    global::TOTAL_SESSIONS.fetch_add(1, Ordering::Relaxed);
    global::USER_SESSIONS.write()
        .entry(user_id.to_string())
        .and_modify(|c| *c += 1)
        .or_insert(1);
}

/// Decrement sessions for a user
pub fn decrement_sessions(user_id: &str) {
    let mut map = global::USER_SESSIONS.write();
    let key = user_id.to_string();
    if let Some(count) = map.get_mut(&key) {
        *count = count.saturating_sub(1);
        if *count == 0 {
            map.remove(&key);
        }
    }
}

/// Increment auth success
pub fn increment_auth_success() {
    global::AUTH_SUCCESS.fetch_add(1, Ordering::Relaxed);
}

/// Increment auth failure
pub fn increment_auth_failure() {
    global::AUTH_FAILURE.fetch_add(1, Ordering::Relaxed);
}

/// Increment messages relayed
pub fn increment_messages_relayed(count: u64) {
    global::MESSAGES_RELAYED.fetch_add(count, Ordering::Relaxed);
}

/// Increment errors
pub fn increment_errors() {
    global::ERRORS.fetch_add(1, Ordering::Relaxed);
}

/// Get metrics as Prometheus-formatted string
pub fn get_metrics() -> String {
    let active = global::ACTIVE_CONNECTIONS.load(Ordering::Relaxed);
    let total = global::TOTAL_SESSIONS.load(Ordering::Relaxed);
    let auth_ok = global::AUTH_SUCCESS.load(Ordering::Relaxed);
    let auth_fail = global::AUTH_FAILURE.load(Ordering::Relaxed);
    let messages = global::MESSAGES_RELAYED.load(Ordering::Relaxed);
    let errors = global::ERRORS.load(Ordering::Relaxed);
    
    let user_sessions = global::USER_SESSIONS.read();
    
    let mut user_lines = String::new();
    for (user_id, count) in user_sessions.iter() {
        user_lines.push_str(&format!(
            "terminal_proxy_user_sessions{{user_id=\"{}\"}} {}\n",
            user_id, count
        ));
    }
    
    format!(
        r#"# HELP terminal_proxy_active_connections Number of active WebSocket connections
# TYPE terminal_proxy_active_connections gauge
terminal_proxy_active_connections {active}

# HELP terminal_proxy_total_sessions Total number of sessions created
# TYPE terminal_proxy_total_sessions counter
terminal_proxy_total_sessions {total}

# HELP terminal_proxy_auth_success_total Successful authentications
# TYPE terminal_proxy_auth_success_total counter
terminal_proxy_auth_success_total {auth_ok}

# HELP terminal_proxy_auth_failure_total Failed authentication attempts
# TYPE terminal_proxy_auth_failure_total counter
terminal_proxy_auth_failure_total {auth_fail}

# HELP terminal_proxy_messages_relayed_total Total messages relayed
# TYPE terminal_proxy_messages_relayed_total counter
terminal_proxy_messages_relayed_total {messages}

# HELP terminal_proxy_errors_total Total errors
# TYPE terminal_proxy_errors_total counter
terminal_proxy_errors_total {errors}

# HELP terminal_proxy_user_sessions Current sessions per user
# TYPE terminal_proxy_user_sessions gauge
{user_lines}"#,
        active = active,
        total = total,
        auth_ok = auth_ok,
        auth_fail = auth_fail,
        messages = messages,
        errors = errors,
        user_lines = user_lines,
    )
}

/// Start the metrics HTTP server
pub fn start_metrics_server(port: u16) {
    let addr = format!("0.0.0.0:{}", port);
    
    tokio::spawn(async move {
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!("Failed to bind metrics server on {}: {}", addr, e);
                return;
            }
        };
        
        info!("Metrics server listening on http://{}/metrics", addr);
        
        loop {
            match listener.accept().await {
                Ok((mut stream, _)) => {
                    let mut buf = [0u8; 1024];
                    // Read and ignore the request (metrics only)
                    let _ = stream.read(&mut buf).await;
                    
                    let metrics_body = get_metrics();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                        Content-Type: text/plain\r\n\
                        Content-Length: {}\r\n\
                        Connection: close\r\n\
                        \r\n\
                        {}",
                        metrics_body.len(),
                        metrics_body
                    );
                    
                    let _ = stream.write_all(response.as_bytes()).await;
                }
                Err(e) => {
                    tracing::warn!("Metrics server accept error: {}", e);
                }
            }
        }
    });
}