-- ============================================================================
-- Self-Healing: Event Healing Log
-- Single source of truth — loaded via getSqlFromFile('healing-log')
-- in events/self-healing.ts
--
-- This is the self-healing variant with columns:
--   id, event_id, strategy, success, explanation, created_at
-- Compare with events-schema.sql's event_healing_log which has the richer
-- columns: error_message, recovery_data (used by events/store.ts)
-- Both variants may coexist; they differ in column layout.
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_healing_log_event_id ON event_healing_log(event_id);
CREATE INDEX IF NOT EXISTS idx_healing_log_strategy ON event_healing_log(strategy);
CREATE INDEX IF NOT EXISTS idx_healing_log_success ON event_healing_log(success);
CREATE INDEX IF NOT EXISTS idx_healing_log_created_at ON event_healing_log(created_at);