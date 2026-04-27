-- Event store for durable execution
-- Migration: 001-events-table
-- Date: 2026-03-29

-- Main events table
CREATE TABLE IF NOT EXISTS events (
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_status_type ON events(status, type);
CREATE INDEX IF NOT EXISTS idx_events_user_status ON events(user_id, status);
CREATE INDEX IF NOT EXISTS idx_events_created_status ON events(created_at, status);

-- Note: SQLite doesn't support COMMENT ON statements
-- Column documentation is maintained in the application code and schema files
