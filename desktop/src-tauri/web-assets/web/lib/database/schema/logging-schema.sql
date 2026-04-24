-- ============================================================================
-- Logging & Telemetry Schema
-- Single source of truth — loaded once via getLoggingSchema() in
-- chat-request-logger.ts, tool-call-tracker.ts, and hitl-audit-logger.ts
-- ============================================================================

-- Chat API request logs with telemetry
CREATE TABLE IF NOT EXISTS chat_request_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    request_size INTEGER NOT NULL,
    response_size INTEGER,
    token_usage_prompt INTEGER,
    token_usage_completion INTEGER,
    token_usage_total INTEGER,
    latency_ms INTEGER,
    streaming BOOLEAN NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT 0,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_user_id ON chat_request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_provider ON chat_request_logs(provider);
CREATE INDEX IF NOT EXISTS idx_chat_logs_model ON chat_request_logs(model);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON chat_request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_success ON chat_request_logs(success);

-- Tool call execution tracker (per-model success/failure scoring)
CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    success INTEGER NOT NULL,
    error TEXT,
    timestamp INTEGER NOT NULL,
    conversation_id TEXT,
    tool_call_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_model
    ON tool_calls(provider, model, timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp
    ON tool_calls(timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_dedup
    ON tool_calls(tool_call_id) WHERE tool_call_id IS NOT NULL;

-- HITL audit trail for human-in-the-loop decisions
CREATE TABLE IF NOT EXISTS hitl_audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    reason TEXT NOT NULL,
    approved BOOLEAN NOT NULL,
    feedback TEXT,
    modified_value TEXT,
    response_time_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_hitl_audit_user_id ON hitl_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_hitl_audit_action ON hitl_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_hitl_audit_created_at ON hitl_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_hitl_audit_approved ON hitl_audit_logs(approved);