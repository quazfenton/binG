-- ============================================================================
-- Filesystem Edit Transaction Persistence Schema
-- Single source of truth — loaded once via getFilesystemEditSchema() in
-- filesystem-edit-session-service.ts and filesystem-edit-database.ts
-- ============================================================================

-- Transaction log for filesystem edits (auto-applied, accepted, or denied)
CREATE TABLE IF NOT EXISTS fs_edit_transactions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    operations_json TEXT NOT NULL,
    errors_json TEXT NOT NULL,
    denied_reason TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fs_transactions_owner
    ON fs_edit_transactions(owner_id);
CREATE INDEX IF NOT EXISTS idx_fs_transactions_conversation
    ON fs_edit_transactions(conversation_id);

-- Denial history for conflict detection
CREATE TABLE IF NOT EXISTS fs_edit_denials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    reason TEXT NOT NULL,
    paths_json TEXT NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES fs_edit_transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_fs_denials_conversation
    ON fs_edit_denials(conversation_id);