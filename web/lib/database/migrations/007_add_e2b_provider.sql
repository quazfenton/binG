-- Migration 007: Add E2B Provider to Quota Tracking
-- Adds E2B sandbox provider to the email_provider_quotas table

INSERT OR IGNORE INTO email_provider_quotas (provider, monthly_limit, current_usage, reset_date, is_disabled, priority)
VALUES ('e2b', 1000, 0, date('now', 'start of month', '+1 month'), FALSE, 5);
