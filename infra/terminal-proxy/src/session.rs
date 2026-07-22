//! Session management for WebSocket terminal connections

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSession {
    pub id: String,
    pub user_id: String,
    pub sandbox_id: String,
    pub workspace_id: String,
    pub created_at: i64,
    pub last_activity: i64,
    pub cols: u16,
    pub rows: u16,
    pub provider: String,  // e2b, daytona, modal, etc.
}

impl TerminalSession {
    pub fn new(user_id: String, sandbox_id: String, provider: String) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: Uuid::new_v4().to_string(),
            user_id,
            sandbox_id,
            workspace_id: String::new(),
            created_at: now,
            last_activity: now,
            cols: 80,
            rows: 24,
            provider,
        }
    }
    
    pub fn touch(&mut self) {
        self.last_activity = chrono::Utc::now().timestamp();
    }
}

/// In-memory session store for fast access
/// Sessions are also persisted to Redis for distributed access
pub struct SessionStore {
    sessions: RwLock<HashMap<String, Arc<RwLock<TerminalSession>>>>,
    user_sessions: RwLock<HashMap<String, Vec<String>>>,  // user_id -> session_ids
    idle_timers: RwLock<HashMap<String, Instant>>,
    idle_timeout: Duration,
}

impl SessionStore {
    pub fn new(idle_timeout_ms: u64) -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            user_sessions: RwLock::new(HashMap::new()),
            idle_timers: RwLock::new(HashMap::new()),
            idle_timeout: Duration::from_millis(idle_timeout_ms),
        }
    }
    
    pub fn create(&self, session: TerminalSession) -> Arc<RwLock<TerminalSession>> {
        let id = session.id.clone();
        let user_id = session.user_id.clone();
        let arc = Arc::new(RwLock::new(session));
        
        self.sessions.write().insert(id.clone(), arc.clone());
        self.user_sessions.write()
            .entry(user_id.clone())
            .or_insert_with(Vec::new)
            .push(id.clone());
        self.idle_timers.write().insert(id, Instant::now());
        
        arc
    }
    
    pub fn get(&self, session_id: &str) -> Option<Arc<RwLock<TerminalSession>>> {
        self.sessions.read().get(session_id).cloned()
    }
    
    pub fn get_by_user(&self, user_id: &str) -> Vec<Arc<RwLock<TerminalSession>>> {
        let session_ids = self.user_sessions.read()
            .get(user_id)
            .cloned()
            .unwrap_or_default();
        
        let sessions = self.sessions.read();
        session_ids
            .into_iter()
            .filter_map(|id| sessions.get(&id).cloned())
            .collect()
    }
    
    pub fn touch(&self, session_id: &str) {
        self.idle_timers.write().insert(session_id.to_string(), Instant::now());
        if let Some(session) = self.sessions.read().get(session_id) {
            session.write().touch();
        }
    }
    
    pub fn remove(&self, session_id: &str) -> Option<Arc<RwLock<TerminalSession>>> {
        self.idle_timers.write().remove(session_id);
        
        let session = self.sessions.write().remove(session_id)?;
        
        if let Ok(s) = session.try_read() {
            let user_id = s.user_id.clone();
            if let Some(ids) = self.user_sessions.write().get_mut(&user_id) {
                ids.retain(|id| id != session_id);
            }
        }
        
        Some(session)
    }
    
    pub fn remove_by_user(&self, user_id: &str) {
        let session_ids = self.user_sessions.write()
            .remove(user_id)
            .unwrap_or_default();
        
        let mut sessions = self.sessions.write();
        let mut idle_timers = self.idle_timers.write();
        
        for id in session_ids {
            sessions.remove(&id);
            idle_timers.remove(&id);
        }
    }
    
    pub fn cleanup_idle(&self) -> Vec<String> {
        let now = Instant::now();
        let timeout = self.idle_timeout;
        let mut removed = Vec::new();
        
        let mut idle_timers = self.idle_timers.write();
        let mut sessions = self.sessions.write();
        let mut user_sessions = self.user_sessions.write();
        
        let expired: Vec<String> = idle_timers
            .iter()
            .filter(|(_, last_active)| now.duration_since(**last_active) > timeout)
            .map(|(id, _)| id.clone())
            .collect();
        
        for id in &expired {
            if let Some(session) = sessions.remove(id) {
                if let Ok(s) = session.try_read() {
                    if let Some(user_ids) = user_sessions.get_mut(&s.user_id) {
                        user_ids.retain(|i| i != id);
                    }
                }
                removed.push(id.clone());
            }
            idle_timers.remove(id);
        }
        
        removed
    }
    
    pub fn len(&self) -> usize {
        self.sessions.read().len()
    }
    
    pub fn is_empty(&self) -> bool {
        self.sessions.read().is_empty()
    }
}