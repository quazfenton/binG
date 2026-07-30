//! Redis-backed session storage for distributed deployments
//! 
//! Sessions are stored in Redis so that multiple proxy instances
//! can share session state (horizontal scaling).

use anyhow::{Result, anyhow};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

use super::session::TerminalSession;

const SESSION_PREFIX: &str = "terminal:session:";
const USER_SESSIONS_PREFIX: &str = "terminal:user:";
const SESSION_TTL_SECS: i64 = 3600; // 1 hour default

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub session_id: String,
    pub user_id: String,
    pub sandbox_id: String,
    pub ws_url: Option<String>,
    pub provider: String,
    pub created_at: i64,
    pub last_activity: i64,
    pub cols: u16,
    pub rows: u16,
}

impl From<&TerminalSession> for SessionState {
    fn from(s: &TerminalSession) -> Self {
        Self {
            session_id: s.id.clone(),
            user_id: s.user_id.clone(),
            sandbox_id: s.sandbox_id.clone(),
            ws_url: None,
            provider: s.provider.clone(),
            created_at: s.created_at,
            last_activity: s.last_activity,
            cols: s.cols,
            rows: s.rows,
        }
    }
}

impl SessionState {
    pub fn with_ws_url(mut self, ws_url: Option<String>) -> Self {
        self.ws_url = ws_url;
        self
    }
}

#[derive(Clone)]
pub struct RedisStore {
    conn: ConnectionManager,
}

impl RedisStore {
    pub async fn new(redis_url: &str) -> Result<Self> {
        let client = redis::Client::open(redis_url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }
    
    /// Save session state to Redis
    pub async fn save_session(&self, state: &SessionState) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("{}{}", SESSION_PREFIX, state.session_id);
        let user_key = format!("{}{}", USER_SESSIONS_PREFIX, state.user_id);
        
        let data = serde_json::to_vec(state)?;
        
        // Set session with TTL
        conn.set_ex(&key, &data, SESSION_TTL_SECS).await?;
        
        // Add to user's session set (sorted set by timestamp)
        let score = state.last_activity as f64;
        let _: () = conn.zadd(&user_key, &state.session_id, score).await?;
        
        // Set TTL on user key too
        conn.expire(&user_key, SESSION_TTL_SECS).await?;
        
        Ok(())
    }
    
    /// Get session by ID
    pub async fn get_session(&self, session_id: &str) -> Result<Option<SessionState>> {
        let mut conn = self.conn.clone();
        let key = format!("{}{}", SESSION_PREFIX, session_id);
        
        let data: Option<Vec<u8>> = conn.get(&key).await?;
        
        match data {
            Some(d) => {
                let state: SessionState = serde_json::from_slice(&d)?;
                Ok(Some(state))
            }
            None => Ok(None),
        }
    }
    
    /// Get all sessions for a user
    pub async fn get_user_sessions(&self, user_id: &str) -> Result<Vec<SessionState>> {
        let mut conn = self.conn.clone();
        let user_key = format!("{}{}", USER_SESSIONS_PREFIX, user_id);
        
        // Get session IDs sorted by activity (most recent first)
        let session_ids: Vec<String> = conn.zrevrange(&user_key, 0, 99).await?;
        
        let mut sessions = Vec::new();
        for id in session_ids {
            if let Some(state) = self.get_session(&id).await? {
                sessions.push(state);
            }
        }
        
        Ok(sessions)
    }
    
    /// Delete a session
    pub async fn delete_session(&self, session_id: &str, user_id: &str) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("{}{}", SESSION_PREFIX, session_id);
        let user_key = format!("{}{}", USER_SESSIONS_PREFIX, user_id);
        
        conn.del(&key).await?;
        let _: () = conn.zrem(&user_key, session_id).await?;
        
        Ok(())
    }
    
    /// Update session activity timestamp
    pub async fn touch_session(&self, session_id: &str) -> Result<()> {
        let mut conn = self.conn.clone();
        let key = format!("{}{}", SESSION_PREFIX, session_id);
        
        let data: Option<Vec<u8>> = conn.get(&key).await?;
        
        if let Some(d) = data {
            let mut state: SessionState = serde_json::from_slice(&d)?;
            state.last_activity = chrono::Utc::now().timestamp();
            
            let new_data = serde_json::to_vec(&state)?;
            conn.set_ex(&key, &new_data, SESSION_TTL_SECS).await?;
            
            // Update score in user sorted set
            let user_key = format!("{}{}", USER_SESSIONS_PREFIX, state.user_id);
            let score = state.last_activity as f64;
            let _: () = conn.zadd(&user_key, &state.session_id, score).await?;
            conn.expire(&user_key, SESSION_TTL_SECS).await?;
        }
        
        Ok(())
    }
    
    /// Get reconnectable sessions for a user
    pub async fn get_reconnectable_sessions(&self, user_id: &str) -> Result<Vec<SessionState>> {
        let sessions = self.get_user_sessions(user_id).await?;
        Ok(        sessions.into_iter().collect())
    }
    
    /// Health check
    pub async fn ping(&self) -> Result<bool> {
        let mut conn = self.conn.clone();
        let result: String = redis::cmd("PING").query_async(&mut conn).await?;
        Ok(result == "PONG")
    }
}