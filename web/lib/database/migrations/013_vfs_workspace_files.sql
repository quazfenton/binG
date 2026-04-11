-- VFS workspace files: server-side persistence of file content
-- Replaces JSON-based storage in vfs-storage/*.json
CREATE TABLE IF NOT EXISTS vfs_workspace_files (
    id TEXT PRIMARY KEY,  -- composite: owner_id || ':' || path
    owner_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    language TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    version INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_id, path)
);

CREATE INDEX IF NOT EXISTS idx_vfs_files_owner ON vfs_workspace_files(owner_id);
CREATE INDEX IF NOT EXISTS idx_vfs_files_path ON vfs_workspace_files(path);
CREATE INDEX IF NOT EXISTS idx_vfs_files_updated ON vfs_workspace_files(updated_at);

-- Workspace metadata: version, last updated, root path
CREATE TABLE IF NOT EXISTS vfs_workspace_meta (
    owner_id TEXT PRIMARY KEY,
    version INTEGER DEFAULT 0,
    root TEXT DEFAULT 'project',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
