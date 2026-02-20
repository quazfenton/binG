-- Migration 003: Quota Tracking Table
-- Adds persistent storage for provider quota usage

CREATE TABLE IF NOT EXISTS provider_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,
  monthly_limit INTEGER NOT NULL DEFAULT 0,
  current_usage INTEGER NOT NULL DEFAULT 0,
  reset_date DATETIME NOT NULL,
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups by provider
CREATE INDEX IF NOT EXISTS idx_provider_quotas_provider ON provider_quotas(provider);

-- Insert default quota limits for known providers
INSERT OR IGNORE INTO provider_quotas (provider, monthly_limit, current_usage, reset_date, is_disabled)
VALUES
  ('composio', 20000, 0, date('now', 'start of month', '+1 month'), FALSE),
  ('arcade', 10000, 0, date('now', 'start of month', '+1 month'), FALSE),
  ('nango', 10000, 0, date('now', 'start of month', '+1 month'), FALSE),
  ('daytona', 5000, 0, date('now', 'start of month', '+1 month'), FALSE),
  ('runloop', 5000, 0, date('now', 'start of month', '+1 month'), FALSE),
  ('microsandbox', 10000, 0, date('now', 'start of month', '+1 month'), FALSE),
  ('e2b', 1000, 0, date('now', 'start of month', '+1 month'), FALSE);
