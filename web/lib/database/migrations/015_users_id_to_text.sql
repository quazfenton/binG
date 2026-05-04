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

-- 0. Drop dependent views BEFORE table swap (SQLite blocks DROP TABLE
--    when a view references its columns; we recreate the view at the end).
DROP VIEW IF EXISTS user_stats;

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

-- 2b. Update foreign keys in referencing tables to ensure types match
-- This prevents issues with strict foreign key checks in some environments
UPDATE api_credentials SET user_id = CAST(user_id AS TEXT);
UPDATE conversations SET user_id = CAST(user_id AS TEXT);
UPDATE usage_logs SET user_id = CAST(user_id AS TEXT);
UPDATE user_preferences SET user_id = CAST(user_id AS TEXT);
UPDATE external_connections SET user_id = CAST(user_id AS TEXT);
UPDATE oauth_sessions SET user_id = CAST(user_id AS TEXT);
UPDATE service_permissions SET user_id = CAST(user_id AS TEXT);
UPDATE sessions SET user_id = CAST(user_id AS TEXT);
UPDATE user_sessions SET user_id = CAST(user_id AS TEXT);
UPDATE user_roles SET user_id = CAST(user_id AS TEXT), granted_by = CAST(granted_by AS TEXT);
UPDATE admin_audit_log SET actor_user_id = CAST(actor_user_id AS TEXT), target_user_id = CAST(target_user_id AS TEXT);
UPDATE user_mfa SET user_id = CAST(user_id AS TEXT);
UPDATE skills SET user_id = CAST(user_id AS TEXT);
UPDATE shadow_commits SET owner_id = 'user:' || CAST(SUBSTR(owner_id, 6) AS TEXT) WHERE owner_id LIKE 'user:%';

-- 3. Drop old table and rename new one
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- 4. Recreate indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_users_email_verification_token_hash ON users(email_verification_token_hash);

-- 5. Recreate dependent views after the swap so they bind to the new users table.
CREATE VIEW IF NOT EXISTS user_stats AS
SELECT
    u.id,
    u.email,
    u.username,
    u.subscription_tier,
    (SELECT COUNT(DISTINCT c2.id) FROM conversations c2 WHERE c2.user_id = u.id) AS total_conversations,
    (SELECT COUNT(*) FROM conversations c2 JOIN messages m2 ON c2.id = m2.conversation_id WHERE c2.user_id = u.id) AS total_messages,
    COALESCE((SELECT SUM(ul2.tokens_used) FROM usage_logs ul2 WHERE ul2.user_id = u.id), 0) AS total_tokens_used,
    COALESCE((SELECT SUM(ul2.cost_usd) FROM usage_logs ul2 WHERE ul2.user_id = u.id), 0) AS total_cost_usd,
    u.created_at AS user_created_at
FROM users u;

COMMIT;

PRAGMA foreign_keys = ON;