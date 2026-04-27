-- Migration 006: Email Provider Quota Tracking
-- Adds persistent storage for email provider quota usage
-- Tracks monthly email sending limits per provider with automatic failover

CREATE TABLE IF NOT EXISTS email_provider_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,
  monthly_limit INTEGER NOT NULL DEFAULT 0,
  current_usage INTEGER NOT NULL DEFAULT 0,
  reset_date DATETIME NOT NULL,
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups by provider
CREATE INDEX IF NOT EXISTS idx_email_quotas_provider ON email_provider_quotas(provider);

-- Insert default quota limits for email providers
-- Priority determines failover order (lower = higher priority)
-- Brevo: 300/month (free tier conservative limit)
-- Resend: 3000/month (free tier)
-- SendGrid: 3000/month (100/day free)
-- SMTP: 10000/month (depends on provider)
INSERT OR IGNORE INTO email_provider_quotas (provider, monthly_limit, current_usage, reset_date, is_disabled, priority)
VALUES
  ('brevo', 300, 0, date('now', 'start of month', '+1 month'), FALSE, 1),
  ('resend', 3000, 0, date('now', 'start of month', '+1 month'), FALSE, 2),
  ('sendgrid', 3000, 0, date('now', 'start of month', '+1 month'), FALSE, 3),
  ('smtp', 10000, 0, date('now', 'start of month', '+1 month'), FALSE, 4);
