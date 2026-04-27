-- Antigravity OAuth accounts table
-- Stores Google OAuth refresh tokens for accessing Antigravity API
CREATE TABLE IF NOT EXISTS antigravity_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'rising-fact-p41fc',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  quota_updated_at INTEGER NOT NULL DEFAULT 0,
  cached_quota TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_antigravity_accounts_user_id ON antigravity_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_antigravity_accounts_email ON antigravity_accounts(email);
CREATE INDEX IF NOT EXISTS idx_antigravity_accounts_enabled ON antigravity_accounts(enabled);
