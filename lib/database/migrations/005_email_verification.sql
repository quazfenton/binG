-- Migration: Email Verification
-- Created: 2026-02-18
-- Purpose: Add email verification support to users table

-- Add email verification columns to users table
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN email_verification_token TEXT UNIQUE;
ALTER TABLE users ADD COLUMN email_verification_expires DATETIME;

-- Add index for verification token lookups
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);

-- Set existing users as verified (backward compatibility)
UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL;
