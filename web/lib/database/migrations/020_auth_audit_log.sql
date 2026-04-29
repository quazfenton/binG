-- MED-5 fix: Auth event audit log table
-- Tracks all authentication events: login, logout, register, password reset, token refresh, MFA
-- Complements admin_audit_log (HIGH-6) which tracks admin-specific actions

CREATE TABLE IF NOT EXISTS auth_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,          -- 'login_success', 'login_failure', 'logout', 'register', 'password_reset_request', 'password_reset_complete', 'token_refresh', 'mfa_setup', 'mfa_challenge_success', 'mfa_challenge_failure', 'mfa_disable'
    user_id TEXT,                      -- NULL for failed login attempts (unknown user)
    email TEXT,                        -- Stored separately for failed logins where userId unknown
    ip_address TEXT,
    user_agent TEXT,
    result TEXT NOT NULL,              -- 'success', 'failure', 'blocked'
    failure_reason TEXT,               -- 'invalid_credentials', 'account_locked', 'mfa_required', 'token_expired', etc.
    metadata TEXT,                     -- JSON blob for event-specific details (e.g., mfa type, session id, etc.)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Index for querying by user and time range
CREATE INDEX IF NOT EXISTS idx_auth_audit_user_id ON auth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event_type ON auth_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created_at ON auth_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_result ON auth_audit_log(result);
CREATE INDEX IF NOT EXISTS idx_auth_audit_email ON auth_audit_log(email);