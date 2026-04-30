-- Migration 019: Add user_mfa table for TOTP-based MFA
-- MED-6 fix: Support TOTP (Google Authenticator compatible) as second factor.

CREATE TABLE IF NOT EXISTS user_mfa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    mfa_type TEXT NOT NULL DEFAULT 'totp',  -- 'totp' (future: 'webauthn')
    secret_encrypted TEXT NOT NULL,          -- TOTP secret, encrypted at rest
    backup_codes TEXT,                       -- JSON array of hashed backup codes
    is_enabled BOOLEAN DEFAULT FALSE,        -- Must be explicitly enabled after setup
    verified_at DATETIME,                    -- When user completed setup verification
    last_used_at DATETIME,                   -- Last successful MFA challenge
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, mfa_type)
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_user_id ON user_mfa(user_id);
CREATE INDEX IF NOT EXISTS idx_user_mfa_enabled ON user_mfa(is_enabled);
