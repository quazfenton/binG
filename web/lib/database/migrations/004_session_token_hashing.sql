-- Migration: Clear all existing sessions for token hashing upgrade
-- Created: 2026-02-18
-- Purpose: When implementing session token hashing, all existing sessions become invalid
-- because they were stored as plain text. This migration clears the sessions table
-- to force users to re-authenticate with the new hashed token system.

-- Clear all existing sessions
DELETE FROM user_sessions;

-- Note: After this migration runs, all users will need to log in again.
-- This is a security improvement - previously stored plain-text session tokens
-- are now invalidated and will be replaced with hashed tokens going forward.