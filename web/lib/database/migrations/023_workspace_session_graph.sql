-- Migration 023: Workspace Session Graph
-- Creates a unified graph connecting all session types (shell, editor, agent,
-- preview, log, execution) per workspace, enabling independent reconnection
-- of each session type.

CREATE TABLE IF NOT EXISTS workspace_session_graph (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('shell', 'editor', 'agent', 'preview', 'log', 'execution')),
  session_subtype TEXT NOT NULL DEFAULT '',
  parent_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'disconnected', 'closed')),
  sandbox_id TEXT,
  provider TEXT,
  metadata TEXT DEFAULT '{}',
  connected_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  disconnected_at INTEGER,
  FOREIGN KEY (parent_session_id) REFERENCES workspace_session_graph(id) ON DELETE SET NULL
);

-- Lookup sessions by workspace for graph queries
CREATE INDEX IF NOT EXISTS idx_session_graph_workspace ON workspace_session_graph(workspace_id, status);

-- Lookup reconnectable sessions (disconnected ones that can be resumed)
CREATE INDEX IF NOT EXISTS idx_session_graph_reconnectable ON workspace_session_graph(workspace_id, user_id, session_type, status);

-- Activity-based cleanup
CREATE INDEX IF NOT EXISTS idx_session_graph_last_active ON workspace_session_graph(last_active_at);

-- Parent-child session relationships
CREATE INDEX IF NOT EXISTS idx_session_graph_parent ON workspace_session_graph(parent_session_id);
