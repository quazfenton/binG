//! WebSocket connection handler
//! 
//! Handles the WebSocket upgrade and bidirectional streaming
//! between clients (xterm.js) and backend sandbox providers.

use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{Result, anyhow};
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::{accept_async, connect_async, WebSocketStream};
use tracing::{debug, info, warn};
use tungstenite::Message;

use crate::auth::{extract_bearer_token, verify_token};
use crate::config::Config;
use crate::metrics;
use crate::redis_store::RedisStore;
use crate::router::Router;
use crate::session::{SessionStore, TerminalSession};

pub struct Connection {
    pub session_id: String,
    pub user_id: String,
    pub sandbox_id: String,
    pub provider: String,
    pub remote_addr: SocketAddr,
    pub connected_at: i64,
}

impl Connection {
    pub async fn handle(
        stream: TcpStream,
        addr: SocketAddr,
        router: &Router,
    ) -> Result<()> {
        // Accept WebSocket connection
        let ws_stream = accept_async(stream).await?;
        let (mut write, mut read) = ws_stream.split();

        // Enforce connection and rate limits before auth
        router.enforce_connection_limit(&addr.ip().to_string())?;
        
        // Read the first message to get headers and authenticate
        let first_msg = match tokio::time::timeout(
            Duration::from_millis(router.config.connection_timeout_ms),
            read.next()
        ).await {
            Ok(Some(Ok(Message::Text(text)))) => text,
            Ok(Some(Ok(Message::Binary(data)))) => {
                String::from_utf8(data)?
            }
            Ok(Some(Ok(Message::Close(_)))) => {
                return Err(anyhow!("Client closed connection during auth"));
            }
            Ok(Some(Err(e))) => {
                return Err(anyhow!("WebSocket error: {}", e));
            }
            Ok(None) => {
                return Err(anyhow!("Connection closed during auth"));
            }
            Err(_) => {
                return Err(anyhow!("Authentication timeout"));
            }
        };
        
        // Parse initial message for auth and session info
        let (claims, sandbox_id, session_id) = Self::authenticate(&first_msg, &router.config, &addr).await?;
        
        info!("Authenticated connection from {} for sandbox {} (user: {})", 
              addr, sandbox_id, claims.user_id());
        
        // Create session
        let conn_session = TerminalSession::new(
            claims.user_id().to_string(),
            sandbox_id.clone(),
            "terminal".to_string(),
        );
        let session_id = conn_session.id.clone();
        
        // Store in local session manager
        let session_arc = router.sessions.create(conn_session);
        
        // Store in Redis for distributed access
        let ws_scheme = router.config.backend_url.replacen("http://", "ws://", 1)
            .replacen("https://", "wss://", 1);
        let ws_url = Some(format!("{}/sandboxes/{}/pty", ws_scheme, sandbox_id));
        let state = crate::redis_store::SessionState::from(&*session_arc.read())
            .with_ws_url(ws_url);
        if let Err(e) = router.redis.save_session(&state).await {
            warn!("Failed to persist session to Redis: {}", e);
        }
        
        // Update metrics
        metrics::increment_connections();
        metrics::increment_sessions(claims.user_id());
        
        // Connect to backend (sandbox provider's WebSocket)
        let backend_url = format!("{}/sandboxes/{}/pty", router.config.backend_url, sandbox_id);
        debug!("Connecting to backend: {}", backend_url);
        
        let (backend_write, backend_read) = match connect_async(&backend_url).await {
            Ok((ws, _)) => ws.split(),
            Err(e) => {
                warn!("Failed to connect to backend: {}, falling back to direct connection", e);
                // Fall back to direct - the client will handle provider-specific logic
                let (a, b) = tokio::io::duplex(1024 * 1024).split();
                (futures_util::SinkExt::sink(a), futures_util::StreamExt::stream(b))
            }
        };
        
        // Create channels for bidirectional relay
        let (client_tx, client_rx) = mpsc::channel::<Message>(100);
        let (backend_tx, backend_rx) = mpsc::channel::<Message>(100);
        
        let max_msg_size = router.config.max_message_size;

        // Relay client -> backend
        let client_to_backend = async {
            let mut local_read = read;
            let mut remote_write = backend_write;

            // Skip auth message, start relay from next message
            while let Some(msg) = local_read.next().await {
                match msg {
                    Ok(Message::Text(t)) => {
                        if t.len() > max_msg_size {
                            warn!("Client message exceeds max size ({} > {}), closing", t.len(), max_msg_size);
                            break;
                        }
                        if remote_write.send(Message::Text(t)).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Binary(b)) => {
                        if b.len() > max_msg_size {
                            warn!("Client message exceeds max size ({} > {}), closing", b.len(), max_msg_size);
                            break;
                        }
                        if remote_write.send(Message::Binary(b)).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Ping(p)) => {
                        if remote_write.send(Message::Pong(p)).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => {
                        break;
                    }
                    _ => {}
                }
            }
        };
        
        // Relay backend -> client
        let backend_to_client = async {
            let mut local_write = write;
            let mut remote_read = backend_read;
            
            while let Some(msg) = remote_read.next().await {
                match msg {
                    Ok(Message::Text(t)) => {
                        if local_write.send(Message::Text(t)).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Binary(b)) => {
                        if local_write.send(Message::Binary(b)).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Ping(p)) => {
                        if local_write.send(Message::Pong(p)).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => {
                        break;
                    }
                    _ => {}
                }
            }
        };
        
        // Run both relays concurrently
        tokio::select! {
            result = client_to_backend => {
                debug!("Client -> Backend relay finished");
            }
            result = backend_to_client => {
                debug!("Backend -> Client relay finished");
            }
        }
        
        // Cleanup
        router.sessions.remove(&session_id);
        if let Err(e) = router.redis.delete_session(&session_id, claims.user_id()).await {
            debug!("Failed to delete session in Redis: {}", e);
        }
        
        metrics::decrement_connections();
        metrics::decrement_sessions(claims.user_id());
        
        info!("Connection closed for session {} (user: {})", session_id, claims.user_id());
        
        Ok(())
    }
    
    async fn authenticate(
        msg: &str,
        config: &Config,
        addr: &SocketAddr,
    ) -> Result<(crate::auth::Claims, String, Option<String>)> {
        // Parse as JSON with initial connection info
        #[derive(Deserialize)]
        struct ConnectMessage {
            token: Option<String>,
            sandbox_id: String,
            session_id: Option<String>,
            #[header(authorization)]
            authorization: Option<String>,
        }
        
        let parsed: ConnectMessage = serde_json::from_str(msg)
            .map_err(|e| anyhow!("Failed to parse connection message: {}", e))?;
        
        // Extract token from message or use provided token
        let token = parsed.token
            .or_else(|| {
                // Try to extract from authorization header in JSON
                parsed.authorization.filter(|h| h.starts_with("Bearer "))
                    .map(|h| h[7..].to_string())
            })
            .ok_or_else(|| anyhow!("No authentication token provided"))?;
        
        // Verify JWT
        let claims = verify_token(&token, &config.jwt_secret, config.jwt_issuer.as_deref())
            .map_err(|e| anyhow!("Authentication failed: {}", e))?;
        
        // Verify user can access this sandbox
        if !claims.can_access_sandbox(&parsed.sandbox_id) {
            return Err(anyhow!("Access denied to sandbox: {}", parsed.sandbox_id));
        }
        
        metrics::increment_auth_success();
        
        Ok((claims, parsed.sandbox_id, parsed.session_id))
    }
}

/// Handle a new TCP connection
pub async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    router: &Router,
) -> Result<()> {
    Connection::handle(stream, addr, router).await
}