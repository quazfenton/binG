-- ============================================================================
-- Workspace Session Graph  (Gap #4 closure)
-- Single source of truth — loaded via execSchemaFile(db, '023_workspace_session_graph')
-- from WorkspaceSessionGraph.
--
-- Unified session graph connecting all session types in a workspace:
--   - Shell sessions (PTY, command-mode)
--   - Editor sessions (VFS/MCP file operations)
--   - Agent sessions (AI agent loops)
--   - Preview sessions (dev server URLs)
--   - Log sessions (service output streams)
--   - Execution sessions (code execution)
--
-- Tables:
--   workspace_session_graph  — Session nodes with parent-child relationships
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_session_graph (
    id                  TEXT    PRIMARY KEY,
    workspace_id        TEXT    NOT NULL,
    user_id             TEXT    NOT NULL,
    session_type        TEXT    NOT NULL
                            CHECK(session_type IN ('shell','editor','agent','preview','log','execution')),
    session_subtype     TEXT    NOT NULL,
    parent_session_id   TEXT,
    status              TEXT    NOT NULL DEFAULT 'active'
                            CHECK(status IN ('active','idle','disconnected','closed')),
    sandbox_id          TEXT,
    provider            TEXT,
    metadata            TEXT,   -- JSON object of additional context
    connected_at        INTEGER NOT NULL,
    last_active_at      INTEGER NOT NULL,
    disconnected_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wsg_workspace
    ON workspace_session_graph(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wsg_workspace_status
    ON workspace_session_graph(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_wsg_parent
    ON workspace_session_graph(parent_session_id) WHERE parent_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wsg_disconnected
    ON workspace_session_graph(status, disconnected_at) WHERE disconnected_at IS NOT NULL;