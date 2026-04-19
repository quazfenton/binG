-- Migration: User Authentication System
-- Description: Creates indexes for authentication-related columns
-- Version: 001
-- Date: 2025-01-16
-- Note: All columns are now in base schema.sql, this migration just ensures indexes exist

-- Create indexes for performance (these are safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active);