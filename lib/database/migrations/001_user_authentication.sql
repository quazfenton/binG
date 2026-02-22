-- Migration: User Authentication System
-- Description: Adds authentication-related columns to existing schema
-- Version: 001
-- Date: 2025-01-16
-- Note: Base schema.sql creates initial tables, this migration adds auth fields
-- Important: SQLite doesn't support ADD COLUMN IF NOT EXISTS.
-- These ALTER TABLE statements will fail if column exists - that's OK for fresh DB.

-- Add last_login column
ALTER TABLE users ADD COLUMN last_login DATETIME;

-- Add reset_token column
ALTER TABLE users ADD COLUMN reset_token TEXT;

-- Add reset_token_expires column
ALTER TABLE users ADD COLUMN reset_token_expires DATETIME;

-- Add email_verified column (for email verification feature)
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;

-- Add is_active to user_sessions
ALTER TABLE user_sessions ADD COLUMN is_active BOOLEAN DEFAULT TRUE;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active);