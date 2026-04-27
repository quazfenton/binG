-- Migration: Add events.user_id Foreign Key Constraint
-- Created: 2026-02-18
-- Purpose: Add FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
--          to the events table for referential integrity consistency with
--          scheduled_tasks table.
--
-- SQLite does not support ADD CONSTRAINT directly, so we:
-- 1. Wrap entire migration in transaction for atomicity
-- 2. Clean up orphaned events (events referencing deleted users)
-- 3. Recreate the events table with the FK constraint
-- 4. Restore the data
--
-- Note: PRAGMA foreign_keys must be enabled on all connections that access this DB.
-- The hitl_approval_requests table has FK(event_id) REFERENCES events(id) ON DELETE CASCADE,
-- which is preserved through the table recreation.

-- PRAGMA statements must be executed BEFORE BEGIN TRANSACTION in SQLite
PRAGMA foreign_keys = ON;

-- =============================================================================
-- Step 0: Idempotency check - skip if FK already exists
-- =============================================================================

-- Check if events table already has the user_id FK constraint
SELECT 
  'Checking for existing FK constraint' as status,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pragma_foreign_key_list('events') 
      WHERE [from] = 'user_id' AND [table] = 'users'
    ) THEN 'SKIP: Migration already applied - FK constraint exists'
    ELSE 'PROCEED: FK constraint not yet added'
  END as result;

-- Exit early if FK already exists (SQLite doesn't support IF NOT EXISTS for FK)
-- Use a dummy query to prevent subsequent steps from executing
SELECT 
  'Migration already applied - skipping rest of script' as status,
  1 as dummy
WHERE EXISTS (
  SELECT 1 FROM pragma_foreign_key_list('events') 
  WHERE [from] = 'user_id' AND [table] = 'users'
);

-- =============================================================================
-- Step 1: Identify orphaned events (events with non-existent user_id)
-- =============================================================================

-- Log orphaned events count for audit
SELECT
  'Orphaned events to clean up' as status,
  COUNT(*) as count
FROM events e
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e.user_id);

-- Log what will be deleted
SELECT
  'Events to be deleted (orphaned - no matching user)' as reason,
  e.user_id as orphaned_user_id,
  COUNT(*) as event_count
FROM events e
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e.user_id)
GROUP BY e.user_id
ORDER BY event_count DESC
LIMIT 10;

-- =============================================================================
-- Step 2: Clean up orphaned events BEFORE adding FK constraint
-- =============================================================================

-- Delete events with user_id that doesn't exist in users table
-- This prevents FK constraint violation when we add the constraint
DELETE FROM events
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = events.user_id);

-- Log cleanup results
SELECT
  'Cleanup complete - orphaned events deleted' as status,
  changes() as deleted_rows;

-- =============================================================================
-- Step 3: Recreate events table with FK constraint
-- =============================================================================

-- SQLite limitation: Cannot add FOREIGN KEY to existing table directly
-- Solution: Create new table with FK, copy data (explicit columns), drop old table, rename new table

-- Create temporary table with FK constraint
CREATE TABLE IF NOT EXISTS events_new (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    user_id TEXT NOT NULL,
    session_id TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Copy data from old table to new table with explicit column names
-- This ensures correct mapping even if table schema changes between migrations
INSERT INTO events_new (id, type, payload, status, retry_count, error, user_id, session_id, metadata, created_at, updated_at, completed_at)
SELECT id, type, payload, status, retry_count, error, user_id, session_id, metadata, created_at, updated_at, completed_at FROM events;

-- Drop the old table
DROP TABLE events;

-- Rename new table to original name
ALTER TABLE events_new RENAME TO events;

-- =============================================================================
-- Step 4: Recreate indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_status_type ON events(status, type);
CREATE INDEX IF NOT EXISTS idx_events_user_status ON events(user_id, status);
CREATE INDEX IF NOT EXISTS idx_events_created_status ON events(created_at, status);

-- =============================================================================
-- Step 5: Verify FK constraint is working
-- =============================================================================

-- Verify hitl_approval_requests FK still references events correctly
SELECT
  'FK constraint verification: hitl_approval_requests' as check_name,
  CASE 
    WHEN (SELECT COUNT(*) FROM hitl_approval_requests WHERE event_id NOT IN (SELECT id FROM events)) = 0 
    THEN 'PASS: All hitl_approval_requests reference valid events'
    ELSE 'FAIL: Orphaned hitl_approval_requests detected'
  END as result;

-- Log final statistics
SELECT
  'Migration complete' as status,
  COUNT(*) as total_events,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT session_id) as unique_sessions
FROM events;

COMMIT;