-- Simple SQLite schema for binG application
-- This can be adapted for PostgreSQL, MySQL, or other databases

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    subscription_tier TEXT DEFAULT 'free', -- free, pro, enterprise
    last_login DATETIME,
    reset_token TEXT,
    reset_token_expires DATETIME,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token TEXT,
    email_verification_expires DATETIME
);

-- Index for email verification token lookups
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);

-- API credentials table (encrypted)
CREATE TABLE IF NOT EXISTS api_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
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
    user_id INTEGER,
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
    user_id INTEGER,
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
    user_id INTEGER NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
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
    user_id INTEGER NOT NULL,
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
    user_id INTEGER,
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
    user_id INTEGER NOT NULL,
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

-- Session management
CREATE TABLE IF NOT EXISTS user_sessions (
    session_id TEXT PRIMARY KEY, -- session token
    user_id INTEGER NOT NULL,
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

-- Views for common queries
CREATE VIEW IF NOT EXISTS user_stats AS
SELECT 
    u.id,
    u.email,
    u.username,
    u.subscription_tier,
    COUNT(DISTINCT c.id) as total_conversations,
    COUNT(DISTINCT m.id) as total_messages,
    COALESCE(SUM(ul.tokens_used), 0) as total_tokens_used,
    COALESCE(SUM(ul.cost_usd), 0) as total_cost_usd,
    u.created_at as user_created_at
FROM users u
LEFT JOIN conversations c ON u.id = c.user_id
LEFT JOIN messages m ON c.id = m.conversation_id
LEFT JOIN usage_logs ul ON u.id = ul.user_id
GROUP BY u.id, u.email, u.username, u.subscription_tier, u.created_at;