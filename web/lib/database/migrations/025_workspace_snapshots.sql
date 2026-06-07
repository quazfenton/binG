-- Migration 025: Workspace Snapshots
-- Persists workspace filesystem snapshots to SQLite so they survive process
-- restarts. Previously snapshots were held in-memory only (WorkspaceFSSnapshotService),
-- meaning a server restart would lose all cached workspace snapshots.
--
-- Snapshots capture the full workspace state when affinity expires:
--  - Provider checkpoints (Sprites, Daytona) for full filesystem capture
--  - Lock file metadata for cache reinstallation
--  - Environment variables for workspace configuration persistence
--  - VFS version reference for content state tracking
--
-- Mirrors the WorkspaceFSSnapshot interface from workspacefs-snapshot-service.ts.

CREATE TABLE IF NOT EXISTS workspace_snapshots (
  workspace_id      TEXT    PRIMARY KEY,
  user_id           TEXT    NOT NULL,
  source_provider   TEXT    NOT NULL,
  source_sandbox_id TEXT    NOT NULL,
  workspace_dir     TEXT    NOT NULL,
  created_at        INTEGER NOT NULL,
  checkpoint_id     TEXT,
  vfs_version       INTEGER NOT NULL DEFAULT 0,
  file_count        INTEGER NOT NULL DEFAULT 0,
  lock_files_json   TEXT    NOT NULL DEFAULT '{}',
  estimated_cache_bytes INTEGER,
  env_vars_json     TEXT,
  expires_at        INTEGER NOT NULL
);

-- Fast lookup by user for stats / admin queries
CREATE INDEX IF NOT EXISTS idx_ws_snapshots_user ON workspace_snapshots(user_id);

-- Prune expired snapshots on schedule
CREATE INDEX IF NOT EXISTS idx_ws_snapshots_expires ON workspace_snapshots(expires_at);
