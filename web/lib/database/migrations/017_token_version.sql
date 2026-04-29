-- Migration 017: Add token_version column to users table
-- HIGH-12: Token versioning for JWT invalidation on password change/admin revocation.
-- Default is 1 so that existing tokens (with tokenVersion ?? 1) remain valid.
-- When a user changes their password or an admin revokes tokens, this version
-- is incremented, causing all previously issued JWTs to fail the version check.

ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1;
