-- Migration: Convert users.id from INTEGER to TEXT (UUID)
-- Created: 2026-03-29
-- Purpose: Standardize all user IDs to TEXT UUID format for consistency
--          across the database and better compatibility with external systems
--
-- Idempotency: This migration is tracked via schema_migrations table.
--
-- SQLite does not support changing column type directly (especially PRIMARY KEY).
-- Solution: Recreate table with new schema, copy data, swap tables.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- 1. Create new table with TEXT primary key
CREATE TABLE users_new (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    subscription_tier TEXT DEFAULT 'free',
    last_login DATETIME,
    reset_token_hash TEXT,
    reset_token_expires DATETIME,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verification_token_hash TEXT,
    email_verification_expires DATETIME,
    token_version INTEGER DEFAULT 1
);

-- 2. Copy data while casting ID to TEXT
INSERT INTO users_new (
    id, email, username, password_hash, created_at, updated_at, is_active, 
    subscription_tier, last_login, reset_token_hash, reset_token_expires, 
    email_verified, email_verification_token_hash, email_verification_expires, token_version
)
SELECT 
    CAST(id AS TEXT), email, username, password_hash, created_at, updated_at, is_active, 
    subscription_tier, last_login, reset_token_hash, reset_token_expires, 
    email_verified, email_verification_token_hash, email_verification_expires, token_version
FROM users;

-- 3. Drop old table and rename new one
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 4. Recreate indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_users_email_verification_token_hash ON users(email_verification_token_hash);

COMMIT;

PRAGMA foreign_keys = ON;