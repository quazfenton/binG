-- 021_messaging_identity.sql
-- Adds messaging profiles and contact discovery

CREATE TABLE IF NOT EXISTS user_messaging_profiles (
    user_id TEXT PRIMARY KEY,
    matrix_id TEXT UNIQUE,
    pgp_public_key TEXT,
    display_name TEXT,
    bio TEXT,
    searchable BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messaging_matrix_id ON user_messaging_profiles(matrix_id);
CREATE INDEX IF NOT EXISTS idx_messaging_searchable ON user_messaging_profiles(searchable);

CREATE TABLE IF NOT EXISTS messaging_contacts (
    user_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    alias TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_contacts_user ON messaging_contacts(user_id);
