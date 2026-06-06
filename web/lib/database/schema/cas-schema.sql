-- ============================================================================
-- Content-Addressable Storage Schema  (Phase 5 of cloudworkstationS plan)
-- Single source of truth — loaded via execSchemaFile(db, 'cas-schema')
-- from ContentAddressableStorage.initializeDatabase().
--
-- Tracks file content blobs stored by SHA256 hash in R2 (or local cache).
-- Decouples file metadata (in vfs_workspace_files) from file content (here).
--
-- Tables:
--   file_content_blobs  — Registry of known blob hashes with ref counting
-- ============================================================================

-- ============================================================================
-- file_content_blobs
-- Tracks all content blobs stored in the content-addressable store.
-- Each blob is keyed by SHA256(content) and stored in R2 (or local disk).
-- Reference counting enables garbage collection of unreferenced blobs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS file_content_blobs (
    hash            TEXT    PRIMARY KEY,  -- SHA256 hex digest of content
    size            INTEGER NOT NULL,     -- Original content size in bytes
    compressed_size INTEGER,              -- Compressed size if stored compressed (NULL if raw)
    ref_count       INTEGER NOT NULL DEFAULT 0,  -- Number of files referencing this blob
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    last_accessed_at TEXT   NOT NULL DEFAULT (datetime('now'))
);

-- Index for GC candidates (low ref_count or old last_accessed_at)
CREATE INDEX IF NOT EXISTS idx_blobs_gc
    ON file_content_blobs(ref_count, last_accessed_at);

-- Index for size-based queries (usage stats, quota tracking)
CREATE INDEX IF NOT EXISTS idx_blobs_size
    ON file_content_blobs(size);
