-- Approval requests table for human-in-the-loop workflows
-- Migration: 003-approval-requests
-- Date: 2026-03-29

CREATE TABLE IF NOT EXISTS approval_requests (
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
CREATE INDEX IF NOT EXISTS idx_approval_requests_event_id ON approval_requests(event_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_user_id ON approval_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_created_at ON approval_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_expires_at ON approval_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_pending ON approval_requests(status, created_at);

-- Note: SQLite doesn't support COMMENT ON statements
-- Column documentation is maintained in the application code and schema files
