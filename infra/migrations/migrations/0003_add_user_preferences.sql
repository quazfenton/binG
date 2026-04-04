-- Migration: Add user_preferences table
-- Created: 2026-03-16
-- Description: Stores user-specific environment variable overrides

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  preferences JSONB NOT NULL DEFAULT '{"OPENCODE_ENABLED": false, "NULLCLAW_ENABLED": false}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Comment
COMMENT ON TABLE user_preferences IS 'User-specific environment variable overrides';
COMMENT ON COLUMN user_preferences.preferences IS 'JSON object with feature flags like OPENCODE_ENABLED, NULLCLAW_ENABLED';
