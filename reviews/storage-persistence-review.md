# Codebase Review: Storage & Persistence

## Overview
The Storage and Persistence layer ensures that user sessions, workspace files, and AI-generated edits are reliably stored and synchronized across different environments. It utilizes a hybrid approach with SQLite for relational metadata and specialized VFS adapters for file storage.

## Key Components

### 1. Filesystem Edit Session Service (`filesystem-edit-session-service.ts`)
A transaction-aware service that manages AI-generated file changes.
- **Transaction Safety**: Groups multiple file operations into a single atomic "Transaction" (write, patch, delete).
- **Git-Backed Rollback**: Intelligent use of Git versions to rollback a set of changes. If the workspace has moved on (newer edits), it falls back to a safe "Manual Revert" to avoid collateral damage.
- **Race Condition Protection**: Explicitly checks the `status` of a transaction (e.g., `denied` or `accepted`) before allowing a transition, preventing concurrent state corruption.
- **Security Limits**: Enforces hard limits on transaction size (10MB) and operation count (50 per tx) to prevent resource exhaustion.

### 2. VFS Sync Layer (`web/lib/virtual-filesystem/sync/`)
Handles the complex bidirectional synchronization of files.
- **Local Folder Sync**: Mirrors local OS directories into the VFS, allowing for a hybrid "Local-first" web experience.
- **Sandbox Sync**: Specialized logic for E2B and Daytona to keep the cloud container's `/workspace` in sync with the VFS.
- **Tar-Pipe Optimization**: Uses high-speed streaming for large batches of files (10x faster for 10+ files).
- **Auto-Snapshot Service**: Periodically captures VFS snapshots, enabling point-in-time recovery for the user.

### 3. Session Store (`session-store.ts`)
The persistence layer for `WorkspaceSession` objects.
- **Hybrid Backend**: Uses SQLite via the `persistence-manager` for production persistence, but maintains an in-memory Map for high-speed access during active sessions.
- **Session Cleanup**: Includes a `clearStaleSessions` method that identifies sandboxes stuck in the `creating` state and prunes them.

## Findings

### 1. Robust Rollback Logic
The "Collateral Damage Prevention" in the `denyTransaction` method is excellent. By checking if the `currentVersion` is greater than the `transactionTip`, the system avoids rolling back changes that might have been made *after* the AI's transaction by the user.

### 2. Performance of In-Memory Sync
The `SandboxFilesystemSync` tracks file hashes locally to avoid redundant uploads. This is a critical performance optimization for large projects.

### 3. Memory Leak Potential
While `filesystemEditSessionService` has a `cleanupOldTransactions` method, it relies on a `setTimeout` (1 hour) inside `acceptTransaction` and `denyTransaction` for cleanup.
- **Risk**: If the server crashes or restarts, these `setTimeout` timers are lost, and the transactions are re-loaded into memory from the DB during the next `getRecentDenials` call.
- **Observation**: The `cleanupOldTransactions` method should be called on a regular interval (e.g., once an hour via a cron job) rather than relying on per-transaction timers.

## Logic Trace: Denying an AI Edit
1.  **User** clicks "Deny" on an AI-generated chat response.
2.  **UI** calls `/api/filesystem/deny` with the `transactionId`.
3.  **Service** loads the transaction from memory or DB.
4.  **Rollback Logic**:
    - If workspace hasn't been modified since, it performs a `git checkout` to the previous version.
    - If newer edits exist, it performs a manual "reverse-patch" for each file in the transaction.
5.  **State Update**: Transaction status is set to `denied`.
6.  **Persistence**: The denial is recorded in the SQLite DB so the LLM "remembers" it in future turns.

## Recommended Actions

| Action | Priority | Reason |
| :--- | :--- | :--- |
| **Interval-based Cleanup** | High | Replace/Supplement per-transaction `setTimeout` with a global interval task for cleaning up the `Map`. |
| **Sync Status Visibility** | Medium | Expose the "Syncing..." status in the UI to prevent users from starting tasks while the VFS is still uploading to the sandbox. |
| **Heredoc Sanitization** | Low | The `unwrapCodeBlock` logic in `vfs-mcp-tools.ts` should be centralized to ensure consistent handling across all extraction paths. |
| **Transaction Audit Log** | Low | Add more detail to the `fs_edit_transactions` table (e.g., the specific prompt that triggered the edit) for better debugging. |
