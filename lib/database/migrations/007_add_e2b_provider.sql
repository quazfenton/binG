-- Migration 007: Add E2B Provider to Quota Tracking
-- Adds E2B sandbox provider to the provider_quotas table

INSERT OR IGNORE INTO provider_quotas (provider, monthly_limit, current_usage, reset_date, is_disabled)
VALUES ('e2b', 1000, 0, date('now', 'start of month', '+1 month'), FALSE);
