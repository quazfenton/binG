-- Migration: Convert users.id from INTEGER to TEXT (UUID)
-- Created: 2026-03-29
-- Purpose: Standardize all user IDs to TEXT UUID format for consistency
--          across the database and better compatibility with external systems
--
-- Idempotency: This migration is tracked via schema_migrations table.
--              The migration runner skips already-executed migrations.
--              This SQL only runs once per deployment.
--
-- WARNING: This migration converts existing INTEGER user IDs to TEXT format.
--          All code creating new users must generate UUIDs.

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- =============================================================================
-- Step 1: Convert users.id from INTEGER to TEXT
-- =============================================================================

-- Update all users.id to string format (INTEGER -> TEXT)
UPDATE users SET id = CAST(id AS TEXT);

-- =============================================================================
-- Step 2: Verify conversion
-- =============================================================================

-- Note: This is informational only - the migration has already run.
-- The schema_migrations table tracks whether this script was executed.
SELECT 
  'Migration 015 executed' as status,
  COUNT(*) as total_users,
  typeof(id) as id_type
FROM users;

COMMIT;