-- Workspace Replay Events (Gap #8 closure)
-- Immutable append-only event stream for full workspace session replay.
-- Records commands, file edits, and agent actions in chronological order
-- so users can replay and audit their entire workspace session.

CREATE TABLE IF NOT EXISTS workspace_replay_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,              -- 'command_execution', 'file_edit', 'agent_action'
    phase TEXT,                            -- 'started', 'completed', 'failed' (for multi-phase events like commands)
    workspace_id TEXT NOT NULL,            -- Workspace identifier (userId:conversationId)
    session_id TEXT,                       -- Session ID for scoping
    user_id TEXT NOT NULL,                 -- The user who performed the action
    
    -- Command execution fields
    command TEXT,                          -- The shell command that was executed
    sandbox_id TEXT,                       -- Sandbox handle ID where command ran
    provider TEXT,                         -- Sandbox provider type
    exit_code INTEGER,                     -- Command exit code (0 = success)
    output_preview TEXT,                   -- Truncated output (first 500 chars) for quick preview
    output_hash TEXT,                      -- SHA-256 of full output for integrity verification
    duration_ms INTEGER,                   -- How long the command took
    
    -- File edit fields
    file_path TEXT,                        -- Relative path within the workspace
    edit_action TEXT,                      -- 'create', 'update', 'delete'
    tool_name TEXT,                        -- 'write_file', 'apply_diff', 'batch_write', 'delete_file'
    content_hash TEXT,                     -- SHA-256 of file content after edit (for integrity)
    diff_summary TEXT,                     -- Human-readable summary (e.g., "+12 -3 lines")
    
    -- Agent action fields
    agent_tool TEXT,                       -- The tool/capability the agent invoked
    agent_model TEXT,                      -- LLM model used (e.g., "claude-sonnet-4")
    agent_provider TEXT,                   -- LLM provider (e.g., "anthropic", "openai")
    agent_iteration INTEGER,               -- Which iteration of the agent loop
    agent_success INTEGER,                 -- 1 = success, 0 = failure
    agent_result_preview TEXT,             -- Truncated result summary
    
    -- Generic metadata for future extensibility
    metadata TEXT,                         -- JSON blob for event-specific details
    
    -- Timestamp (milliseconds since epoch for precise ordering)
    timestamp_ms INTEGER NOT NULL,         -- When the event occurred (client-side time)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Query indexes: by workspace + time (primary access pattern for replay)
CREATE INDEX IF NOT EXISTS idx_replay_workspace_time
    ON workspace_replay_events(workspace_id, timestamp_ms);
    
-- Query index: by session + time
CREATE INDEX IF NOT EXISTS idx_replay_session_time
    ON workspace_replay_events(session_id, timestamp_ms);

-- Query index: by event type (for filtering)
CREATE INDEX IF NOT EXISTS idx_replay_event_type
    ON workspace_replay_events(event_type, timestamp_ms);

-- Query index: by user
CREATE INDEX IF NOT EXISTS idx_replay_user_time
    ON workspace_replay_events(user_id, timestamp_ms DESC);

-- Query index: by file path (for "what changed this file?" queries)
CREATE INDEX IF NOT EXISTS idx_replay_file_path
    ON workspace_replay_events(file_path, timestamp_ms);
