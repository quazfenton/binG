-- Migration: Add user_api_keys table
-- Created: 2026-03-03
-- Description: Store encrypted user API keys for persistence across sessions

CREATE TABLE IF NOT EXISTS user_api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    encrypted_keys TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);

-- Comment describing the table
-- This table stores user-provided API keys encrypted with user-specific salt
-- Keys are encrypted client-side before being sent to the server
-- Users can export/import their keys for backup
