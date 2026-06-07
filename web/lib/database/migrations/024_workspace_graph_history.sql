-- Migration 024: Workspace Graph History
-- Stores periodic snapshots of workspace graph state so users and AI agents
-- can see how workspace state evolved over time and compare snapshots.

CREATE TABLE IF NOT EXISTS workspace_graph_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  diagnostic_count INTEGER NOT NULL DEFAULT 0,
  running_services INTEGER NOT NULL DEFAULT 0,
  active_previews INTEGER NOT NULL DEFAULT 0,
  total_nodes INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER NOT NULL,
  change_reason TEXT NOT NULL DEFAULT 'periodic'
);

-- Lookup snapshots by workspace, ordered by time
CREATE INDEX IF NOT EXISTS idx_graph_history_workspace ON workspace_graph_history(workspace_id, recorded_at);

-- Prune old snapshots efficiently
CREATE INDEX IF NOT EXISTS idx_graph_history_recorded ON workspace_graph_history(recorded_at);
