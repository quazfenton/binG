//! Request router for the terminal proxy

use std::sync::Arc;

use anyhow::Result;
use dashmap::DashMap;
use parking_lot::RwLock;
use std::collections::HashMap;

use crate::config::Config;
use crate::redis_store::RedisStore;
use crate::session::SessionStore;

/// Connection router with connection state management
pub struct Router {
    pub config: Config,
    pub redis: RedisStore,
    pub sessions: Arc<SessionStore>,
    
    // Per-connection state (connection_id -> state)
    connection_state: DashMap<String, ConnectionState>,
    
    // Rate limiting state (ip address -> request count)
    rate_limit: Arc<RwLock<HashMap<String, RateLimitEntry>>>,
}

#[derive(Debug, Clone)]
pub struct ConnectionState {
    pub connection_id: String,
    pub user_id: String,
    pub sandbox_id: String,
    pub authenticated: bool,
    pub connected_at: i64,
}

#[derive(Debug, Clone)]
pub struct RateLimitEntry {
    pub count: u32,
    pub window_start: i64,
}

impl Router {
    pub fn new(redis: RedisStore, config: Config) -> Self {
        Self {
            config,
            redis,
            sessions: Arc::new(SessionStore::new(
                // Default 15 minutes idle timeout
                900000
            )),
            connection_state: DashMap::new(),
            rate_limit: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Check if IP is rate limited
    pub fn check_rate_limit(&self, ip: &str) -> bool {
        let mut rate_limit = self.rate_limit.write();
        let now = chrono::Utc::now().timestamp_millis();
        let window_ms = self.config.rate_limit_window_ms as i64;
        
        let entry = rate_limit.entry(ip.to_string()).or_insert_with(|| RateLimitEntry {
            count: 0,
            window_start: now,
        });
        
        // Reset window if expired
        if now - entry.window_start > window_ms {
            entry.count = 0;
            entry.window_start = now;
        }
        
        // Check limit
        if entry.count >= self.config.rate_limit_requests {
            return false; // Rate limited
        }
        
        entry.count += 1;
        true
    }
    
    /// Get connection state
    pub fn get_connection_state(&self, conn_id: &str) -> Option<ConnectionState> {
        self.connection_state.get(conn_id).map(|r| r.clone())
    }
    
    /// Set connection state
    pub fn set_connection_state(&self, conn_id: String, state: ConnectionState) {
        self.connection_state.insert(conn_id, state);
    }
    
    /// Remove connection state
    pub fn remove_connection_state(&self, conn_id: &str) {
        self.connection_state.remove(conn_id);
    }
    
    /// Get current connection count
    pub fn connection_count(&self) -> usize {
        self.sessions.len()
    }
    
    /// Check if max connections reached
    pub fn can_accept_connection(&self) -> bool {
        self.sessions.len() < self.config.max_connections
    }
}