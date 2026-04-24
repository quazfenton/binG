-- ============================================================================
-- Event System Schema
-- Single source of truth — loaded once via getEventsSchema() in
-- events/store.ts, events/scheduler.ts, events/self-healing.ts, and
-- events/human-in-loop.ts
-- ============================================================================

-- Append-only event log
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
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_status_type ON events(status, type);
CREATE INDEX IF NOT EXISTS idx_events_user_status ON events(user_id, status);
CREATE INDEX IF NOT EXISTS idx_events_created_status ON events(created_at, status);

-- Scheduled tasks (cron-backed)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    payload TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_run DATETIME,
    next_run DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    timezone TEXT DEFAULT 'UTC',
    catch_up BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_active ON scheduled_tasks(active);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_type ON scheduled_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_active ON scheduled_tasks(next_run, active);

-- Human-in-the-loop approval requests
CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    event_id TEXT,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    resolved_at DATETIME,
    resolution TEXT,
    approver_feedback TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_event_id ON approval_requests(event_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_user_id ON approval_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_created_at ON approval_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_expires_at ON approval_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_pending ON approval_requests(status, created_at);

-- Self-healing log for event recovery attempts
CREATE TABLE IF NOT EXISTS event_healing_log (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    strategy TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    recovery_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_healing_log_event_id ON event_healing_log(event_id);
CREATE INDEX IF NOT EXISTS idx_healing_log_strategy ON event_healing_log(strategy);
CREATE INDEX IF NOT EXISTS idx_healing_log_success ON event_healing_log(success);
CREATE INDEX IF NOT EXISTS idx_healing_log_created_at ON event_healing_log(created_at);