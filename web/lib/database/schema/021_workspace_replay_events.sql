-- ============================================================================
-- Workspace Replay Events  (Gap #8 closure)
-- Single source of truth — loaded via execSchemaFile(db, '021_workspace_replay_events')
-- from WorkspaceReplayService.
--
-- Immutable append-only event-stream recording for full workspace session replay.
-- Records every command execution, file edit, and agent action in chronological
-- order so users can replay and audit their entire workspace session.
--
-- Tables:
--   workspace_replay_events  — Chronological replay event records
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_replay_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type          TEXT    NOT NULL
                            CHECK(event_type IN ('command_execution','file_edit','agent_action')),
    phase               TEXT    CHECK(phase IN ('started','completed','applied','failed')),
    workspace_id        TEXT    NOT NULL,
    session_id          TEXT,
    user_id             TEXT    NOT NULL,
    command             TEXT,
    sandbox_id          TEXT,
    provider            TEXT,
    exit_code           INTEGER,
    output_preview      TEXT,
    output_hash         TEXT,
    duration_ms         INTEGER,
    file_path           TEXT,
    edit_action          TEXT    CHECK(edit_action IN ('create','update','delete')),
    tool_name           TEXT,
    content_hash        TEXT,
    diff_summary        TEXT,
    agent_tool          TEXT,
    agent_model         TEXT,
    agent_provider      TEXT,
    agent_iteration     INTEGER,
    agent_success       INTEGER CHECK(agent_success IN (0,1)),
    agent_result_preview TEXT,
    metadata            TEXT,   -- JSON object of additional context
    timestamp_ms        INTEGER NOT NULL,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wre_workspace
    ON workspace_replay_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wre_session
    ON workspace_replay_events(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wre_timestamp
    ON workspace_replay_events(workspace_id, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_wre_event_type
    ON workspace_replay_events(workspace_id, event_type);
CREATE INDEX IF NOT EXISTS idx_wre_file_path
    ON workspace_replay_events(file_path) WHERE file_path IS NOT NULL;