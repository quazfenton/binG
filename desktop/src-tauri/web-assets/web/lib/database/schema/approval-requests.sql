-- ============================================================================
-- Human-in-the-Loop: Approval Requests (HITL variant)
-- Single source of truth — loaded via getSqlFromFile('approval-requests')
-- in events/human-in-loop.ts
--
-- This table stores human-in-the-loop responses with fields:
--   details (JSON blob), response, responded_at
--
-- Distinct from the event-system approval_requests which uses:
--   description, payload, resolution, approver_feedback
--
-- This table is intentionally named differently to avoid schema conflicts.
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_event_id ON hitl_approval_requests(event_id);
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_status ON hitl_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_user_id ON hitl_approval_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_created_at ON hitl_approval_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_hitl_approval_requests_expires_at ON hitl_approval_requests(expires_at);