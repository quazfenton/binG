-- Migration: 016_hitl_approval_requests
-- Date: 2026-04-29
-- Purpose: Create the hitl_approval_requests table for human-in-the-loop workflows.
--          This table is used by events/human-in-loop.ts for approval responses.
--          Migration 014 references this table so it must exist.

PRAGMA foreign_keys = ON;

-- Create hitl_approval_requests table (distinct from approval_requests in migration 003)
CREATE TABLE IF NOT EXISTS hitl_approval_requests (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,
    expires_at DATETIME,
    user_id TEXT,
    updated_at DATETIME,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_event_id ON hitl_approval_requests(event_id);
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_status ON hitl_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_user_id ON hitl_approval_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_created_at ON hitl_approval_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_expires_at ON hitl_approval_requests(expires_at);

-- Log creation
SELECT 'Created hitl_approval_requests table' as status, 
       COUNT(*) as initial_count 
FROM hitl_approval_requests;