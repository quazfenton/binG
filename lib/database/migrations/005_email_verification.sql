-- Migration: Email Verification
-- Created: 2026-02-18
-- Purpose: Add email verification token fields to users table
-- Note: email_verified column is added by migration 001
-- Note: SQLite doesn't support adding UNIQUE columns via ALTER TABLE

-- Add email_verification_token column (without UNIQUE constraint)
ALTER TABLE users ADD COLUMN email_verification_token TEXT;

-- Add email_verification_expires column
ALTER TABLE users ADD COLUMN email_verification_expires DATETIME;

-- Create unique index for verification token lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);

-- SECURITY FIX: Only verify users who were created BEFORE this migration
-- Users created AFTER this migration must verify their email normally
-- This prevents auto-verifying users who registered but weren't verified yet
-- 
-- Logic: 
-- - If email_verified IS NULL: Column didn't exist, user was created before migration 001
--   → Mark as verified (backward compatibility for existing unverified users)
-- - If email_verified = FALSE: User explicitly not verified
--   → Keep as FALSE, they must verify normally
-- - If email_verified = TRUE: Already verified
--   → No change needed
UPDATE users 
SET email_verified = TRUE, 
    email_verification_token = NULL,
    email_verification_expires = NULL
WHERE email_verified IS NULL;

-- Log the migration for audit
-- This helps track how many users were auto-verified vs need verification
SELECT 
  'Email verification migration complete' as status,
  (SELECT COUNT(*) FROM users WHERE email_verified = TRUE) as verified_users,
  (SELECT COUNT(*) FROM users WHERE email_verified = FALSE) as unverified_users;
