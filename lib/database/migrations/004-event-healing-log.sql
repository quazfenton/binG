-- Event healing log for self-healing tracking
-- Migration: 004-event-healing-log
-- Date: 2026-03-29

CREATE TABLE IF NOT EXISTS event_healing_log (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  explanation TEXT,
  fix_applied TEXT,
  confidence REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_healing_log_event_id ON event_healing_log(event_id);
CREATE INDEX IF NOT EXISTS idx_healing_log_strategy ON event_healing_log(strategy);
CREATE INDEX IF NOT EXISTS idx_healing_log_success ON event_healing_log(success);
CREATE INDEX IF NOT EXISTS idx_healing_log_created_at ON event_healing_log(created_at);

-- Comments
COMMENT ON TABLE event_healing_log IS 'Self-healing attempt history for failed events';
COMMENT ON COLUMN event_healing_log.id IS 'Unique healing log identifier (UUID)';
COMMENT ON COLUMN event_healing_log.event_id IS 'Associated event ID that was healed';
COMMENT ON COLUMN event_healing_log.strategy IS 'Healing strategy used (retry, llm, fallback, skip)';
COMMENT ON COLUMN event_healing_log.success IS 'Whether healing was successful';
COMMENT ON COLUMN event_healing_log.explanation IS 'Explanation of healing attempt';
COMMENT ON COLUMN event_healing_log.fix_applied IS 'Fix that was applied (if any)';
COMMENT ON COLUMN event_healing_log.confidence IS 'Confidence score (0.0-1.0)';
