//! Configuration for the terminal proxy

use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    // Server
    pub listen_addr: String,
    pub worker_threads: usize,
    pub max_connections: usize,
    
    // Redis
    pub redis_url: String,
    
    // Security
    pub jwt_secret: String,
    pub jwt_issuer: Option<String>,
    
    // Timeouts (milliseconds)
    pub connection_timeout_ms: u64,
    pub idle_timeout_ms: u64,
    pub auth_timeout_ms: u64,
    
    // Rate limiting
    pub rate_limit_requests: u32,
    pub rate_limit_window_ms: u64,
    
    // Backend (sandbox providers)
    pub backend_url: String,
    
    // Metrics
    pub metrics_port: u16,
    
    // Message limits
    pub max_message_size: usize,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            listen_addr: env::var("TERMINAL_PROXY_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:8080".into()),
            
            worker_threads: env::var("TERMINAL_PROXY_WORKERS")
                .unwrap_or_else(|_| "4".into())
                .parse()
                .unwrap_or(4),
            
            max_connections: env::var("TERMINAL_PROXY_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "10000".into())
                .parse()
                .unwrap_or(10000),
            
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".into()),
            
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "change-me-in-production".into()),
            
            jwt_issuer: env::var("TERMINAL_PROXY_JWT_ISSUER").ok(),
            
            connection_timeout_ms: env::var("TERMINAL_PROXY_CONNECTION_TIMEOUT_MS")
                .unwrap_or_else(|_| "5000".into())
                .parse()
                .unwrap_or(5000),
            
            idle_timeout_ms: env::var("TERMINAL_PROXY_IDLE_TIMEOUT_MS")
                .unwrap_or_else(|_| "900000".into()) // 15 minutes
                .parse()
                .unwrap_or(900000),
            
            auth_timeout_ms: env::var("TERMINAL_PROXY_AUTH_TIMEOUT_MS")
                .unwrap_or_else(|_| "10000".into())
                .parse()
                .unwrap_or(10000),
            
            rate_limit_requests: env::var("TERMINAL_PROXY_RATE_LIMIT_REQUESTS")
                .unwrap_or_else(|_| "1000".into())
                .parse()
                .unwrap_or(1000),
            
            rate_limit_window_ms: env::var("TERMINAL_PROXY_RATE_LIMIT_WINDOW_MS")
                .unwrap_or_else(|_| "1000".into())
                .parse()
                .unwrap_or(1000),
            
            backend_url: env::var("TERMINAL_PROXY_BACKEND_URL")
                .unwrap_or_else(|_| "http://localhost:3000".into()),
            
            metrics_port: env::var("TERMINAL_PROXY_METRICS_PORT")
                .unwrap_or_else(|_| "9090".into())
                .parse()
                .unwrap_or(9090),
            
            max_message_size: env::var("TERMINAL_PROXY_MAX_MESSAGE_SIZE")
                .unwrap_or_else(|_| "1048576".into()) // 1MB
                .parse()
                .unwrap_or(1048576),
        }
    }
}