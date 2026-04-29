-- Simple SQLite schema for binG application
-- This can be adapted for PostgreSQL, MySQL, or other databases

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    subscription_tier TEXT DEFAULT 'free', -- free, pro, enterprise
    last_login DATETIME,
    reset_token_hash TEXT,
    reset_token_expires DATETIME,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token_hash TEXT,
    email_verification_expires DATETIME,
    token_version INTEGER DEFAULT 1  -- HIGH-12: Incremented on password change/admin revocation to invalidate existing JWTs
);

-- Index for email verification token hash lookups
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token_hash ON users(email_verification_token_hash);

-- API credentials table (encrypted)
CREATE TABLE IF NOT EXISTS api_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL, -- openai, anthropic, google, etc.
    api_key_encrypted TEXT NOT NULL,
    api_key_hash TEXT NOT NULL, -- for verification without decryption
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE(user_id, provider)
);

-- Chat conversations
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, -- UUID
    user_id TEXT,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_archived BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Chat messages
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, -- UUID
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL, -- user, assistant, system
    content TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    token_count INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);

-- Usage tracking
CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, preference_key)
);

-- Email provider quotas (for email service failover)
CREATE TABLE IF NOT EXISTS email_provider_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,
  monthly_limit INTEGER NOT NULL DEFAULT 0,
  current_usage INTEGER NOT NULL DEFAULT 0,
  reset_date DATETIME NOT NULL,
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for email provider quota lookups
CREATE INDEX IF NOT EXISTS idx_email_quotas_provider ON email_provider_quotas(provider);

-- OAuth and external connections
CREATE TABLE IF NOT EXISTS external_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    provider_display_name TEXT,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at DATETIME,
    scopes TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    last_accessed_at DATETIME,
    refresh_attempts INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE(user_id, provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS oauth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    provider TEXT NOT NULL,
    state TEXT NOT NULL,
    nonce TEXT,
    redirect_uri TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at DATETIME,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS service_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    connection_id INTEGER NOT NULL,
    service_name TEXT NOT NULL,
    permission_level TEXT NOT NULL DEFAULT 'read',
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES external_connections (id) ON DELETE CASCADE,
    UNIQUE(user_id, connection_id, service_name)
);

CREATE TABLE IF NOT EXISTS token_refresh_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL,
    attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    FOREIGN KEY (connection_id) REFERENCES external_connections (id) ON DELETE CASCADE
);

-- Indexes for OAuth tables
CREATE INDEX IF NOT EXISTS idx_token_refresh_connection ON token_refresh_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_ext_conn_user_provider ON external_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_ext_conn_active ON external_connections(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_sessions_state ON oauth_sessions(state);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_svc_perm_user ON service_permissions(user_id, service_name);

-- Seed default email provider quotas
INSERT OR IGNORE INTO email_provider_quotas (provider, monthly_limit, current_usage, reset_date, is_disabled, priority)
VALUES
  ('brevo', 300, 0, date('now', 'start of month', '+1 month'), FALSE, 1),
  ('resend', 3000, 0, date('now', 'start of month', '+1 month'), FALSE, 2),
  ('sendgrid', 3000, 0, date('now', 'start of month', '+1 month'), FALSE, 3),
  ('smtp', 10000, 0, date('now', 'start of month', '+1 month'), FALSE, 4),
  ('e2b', 1000, 0, date('now', 'start of month', '+1 month'), FALSE, 5);

-- Terminal sessions table (for sandbox session tracking)
-- This is referenced by events.session_id FK
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_active TEXT DEFAULT CURRENT_TIMESTAMP,
    config TEXT,
    status TEXT DEFAULT 'active',
    terminal_output TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_sandbox ON sessions(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active);

-- User authentication sessions (for auth token hashing)
-- Note: session_id stores a SHA-256 hash of the session token for security.
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id TEXT PRIMARY KEY, -- session token hash (SHA-256)
    user_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
-- Composite index for message queries (conversation + time ordering)
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_credentials_user_id ON api_credentials(user_id);
-- Composite index for API credential lookups
CREATE INDEX IF NOT EXISTS idx_api_credentials_user_provider ON api_credentials(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
-- Composite index for session queries
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_expires ON user_sessions(user_id, expires_at);
-- Index on users email for authentication lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
-- Composite index for user preferences
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_key ON user_preferences(user_id, preference_key);

-- Shadow commits table (replaces .agent-commits filesystem storage)
CREATE TABLE IF NOT EXISTS shadow_commits (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,  -- user ID (e.g., 'user:123' or 'anon:sessionId')
    message TEXT NOT NULL,
    author TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT,
    integration TEXT,
    workspace_version INTEGER,
    diff TEXT,
    transactions TEXT NOT NULL, -- JSON array of transaction entries
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shadow_commits_session_id ON shadow_commits(session_id);
CREATE INDEX IF NOT EXISTS idx_shadow_commits_owner_id ON shadow_commits(owner_id);
CREATE INDEX IF NOT EXISTS idx_shadow_commits_timestamp ON shadow_commits(timestamp);
CREATE INDEX IF NOT EXISTS idx_shadow_commits_created_at ON shadow_commits(created_at);

-- Skills table (DB-backed skill persistence complementing filesystem SkillsManager)
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    version TEXT DEFAULT '1.0.0',
    system_prompt TEXT,
    tags TEXT,
    workflows TEXT,
    sub_capabilities TEXT,
    reinforcement TEXT,
    location TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    source TEXT DEFAULT 'manual',
    extracted_from_event TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);
CREATE INDEX IF NOT EXISTS idx_skills_created_at ON skills(created_at);

-- Views for common queries
CREATE VIEW IF NOT EXISTS user_stats AS
SELECT 
    u.id,
    u.email,
    u.username,
    u.subscription_tier,
    -- Use DISTINCT to get unique conversations (handles multiple messages per conversation)
    (SELECT COUNT(DISTINCT c2.id) FROM conversations c2 WHERE c2.user_id = u.id) as total_conversations,
    -- Count total messages via conversation relationship
    (SELECT COUNT(*) FROM conversations c2 JOIN messages m2 ON c2.id = m2.conversation_id WHERE c2.user_id = u.id) as total_messages,
    -- Aggregate usage_logs independently (no JOIN to messages)
    COALESCE((SELECT SUM(ul2.tokens_used) FROM usage_logs ul2 WHERE ul2.user_id = u.id), 0) as total_tokens_used,
    COALESCE((SELECT SUM(ul2.cost_usd) FROM usage_logs ul2 WHERE ul2.user_id = u.id), 0) as total_cost_usd,
    u.created_at as user_created_at
FROM users u;