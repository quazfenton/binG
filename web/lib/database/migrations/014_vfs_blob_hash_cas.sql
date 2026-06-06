-- VFS blob hash column: content-addressable storage integration
-- Phase 5 of cloudworkstationS plan — split SQL metadata from blob storage
-- Adds blob_hash column to reference file_content_blobs table
-- Existing content stays inline (backward compatible); new writes can use CAS

-- Add blob_hash column (nullable — NULL means content is stored inline)
ALTER TABLE vfs_workspace_files ADD COLUMN blob_hash TEXT;

-- Add compressed column to track whether inline content is compressed
ALTER TABLE vfs_workspace_files ADD COLUMN is_compressed INTEGER DEFAULT 0;

-- Index for blob_hash lookups (find all files referencing a blob)
CREATE INDEX IF NOT EXISTS idx_vfs_files_blob_hash ON vfs_workspace_files(blob_hash);
