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

-- Set existing users as verified (backward compatibility)
UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL OR email_verified = FALSE;
