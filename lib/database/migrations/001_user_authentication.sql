-- Migration: User Authentication System
-- Description: Creates or updates user and session tables for authentication
-- Version: 001
-- Date: 2025-01-16

-- Users table with enhanced fields for authentication
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT TRUE,
    subscription_tier TEXT DEFAULT 'free',
    email_verified BOOLEAN DEFAULT FALSE,
    reset_token TEXT,
    reset_token_expires DATETIME
);

-- User sessions table for session management
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY, -- session token (UUID)
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Indexes for performance (IF NOT EXISTS supported in newer SQLite)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active);