-- Migration: OAuth Integration
-- Version: 002
-- Note: All tables are now in base schema.sql, this migration ensures indexes exist

-- Indexes for OAuth tables (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_token_refresh_connection ON token_refresh_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_ext_conn_user_provider ON external_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_ext_conn_active ON external_connections(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_sessions_state ON oauth_sessions(state);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_svc_perm_user ON service_permissions(user_id, service_name);
