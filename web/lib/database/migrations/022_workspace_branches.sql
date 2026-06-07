-- Workspace Branches (Gap #1 closure: Workspace Forking/Branching)
-- Tracks branch lineages so workspaces can be forked and diverged independently.
-- Each branch is a workspace with its own files, processes, services, and env vars.

CREATE TABLE IF NOT EXISTS workspace_branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL UNIQUE,        -- The branch's workspace identifier (e.g., "user-123:conv-abc#feature-x")
    branch_name TEXT NOT NULL,                -- Human-readable branch name (e.g., "main", "feature-x")
    parent_workspace_id TEXT,                 -- The workspace this branch was forked from (NULL for root "main" branch)
    root_workspace_id TEXT NOT NULL,          -- The root/original workspace (never changes — anchors the lineage)
    user_id TEXT NOT NULL,                    -- Owner of this branch
    forked_from_snapshot_id TEXT,             -- Snapshot ID that was used to create this fork
    status TEXT NOT NULL DEFAULT 'active',    -- 'active', 'archived', 'merged'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at DATETIME,
    metadata TEXT,                            -- JSON blob: description, tags, etc.
    FOREIGN KEY (parent_workspace_id) REFERENCES workspace_branches(workspace_id) ON DELETE SET NULL
);

-- Index for finding all branches of a root workspace
CREATE INDEX IF NOT EXISTS idx_branches_root
    ON workspace_branches(root_workspace_id);
    
-- Index for finding a branch by name within a root workspace
CREATE INDEX IF NOT EXISTS idx_branches_name
    ON workspace_branches(root_workspace_id, branch_name);

-- Index for active branches by user
CREATE INDEX IF NOT EXISTS idx_branches_user
    ON workspace_branches(user_id, status, last_accessed_at DESC);

-- Index for parent lookup
CREATE INDEX IF NOT EXISTS idx_branches_parent
    ON workspace_branches(parent_workspace_id);
