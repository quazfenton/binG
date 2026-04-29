web/lib/observability/constraint-violation-monitor.ts
    }
  ): Promise<T> {
    try {
      return operation();



5 hours ago
P1: Async operation failures are not caught because operation() is returned without await inside try/catch.
Prompt for AI agents

30 hidden conversations
Load more…
desktop/src-tauri/src/commands.rs
        .unwrap_or(3718);
    // Generate a session token for MCP authentication
    let token = uuid::Uuid::new_v4().to_string();



5 hours ago
P2: The MCP session token is generated fresh on every call but never persisted or validated by start_mcp_sidecar_bridge. Any value could be sent and accepted, making this authentication no-op. Either store the token in shared state and check it in the bridge, or remove the token field to avoid a false sense of security.
Prompt for AI agents

packages/shared/cli/lib/bash-executor-local.ts
    const normalized = path.normalize(path.resolve(filePath));
    const normalizedRoot = path.normalize(path.resolve(workspaceRoot));
    // Only allow if path starts with root, NOT if root starts with path (which is insecure)
    return normalized.startsWith(normalizedRoot + path.sep) || normalized === normalizedRoot;



5 hours ago
P2: Root workspace paths are misvalidated because appending path.sep creates a doubled separator, causing valid child paths under / or drive roots to be rejected.
Prompt for AI agents
Suggested change
    return normalized.startsWith(normalizedRoot + path.sep) || normalized === normalizedRoot;
    const rootPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    return normalized === normalizedRoot || normalized.startsWith(rootPrefix);

desktop/src-tauri/src/settings.rs
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&path, json)



5 hours ago
P2: TOCTOU race: the file is written with default permissions via fs::write, then restricted afterward. During that window, the settings file (containing auth tokens) is world-readable. On Unix, use OpenOptions with mode 0o600 set before writing, or write to a temp file with restricted permissions and atomically rename it.
Prompt for AI agents

packages/shared/lib/workspace-boundary.ts
      } else {
        // .. above root — keep it so the comparison will correctly
        // flag the path as outside the workspace
        resolved.push('..');



5 hours ago
P2: For absolute paths, .. above root should be discarded (on real filesystems /../.. resolves to /). Currently normalizePath('/../../../etc/passwd') returns '/../../../etc/passwd' instead of '/etc/passwd'. While this doesn't cause a false negative in isOutsideWorkspace, it produces incorrect normalized paths that could confuse downstream consumers.
Prompt for AI agents
.
web/lib/observability/constraint-violation-monitor.ts
    this.throttler.queueAlert(alert);
    // Track dropped alerts
    if (!this.throttler.shouldSendImmediately()) {



5 hours ago
P2: totalAlertsDropped is incremented using a post-check that does not represent actual drops, leading to incorrect drop metrics.   packages/shared/lib/workspace-boundary.ts
export const VFS_VIRTUAL_PREFIXES = [
  '/project/',
  '/workspace/',
  '/home/',



5 hours ago
P0: Including /home/ as a VFS virtual prefix effectively disables workspace boundary protection for all paths under /home/. Since real filesystem paths on Linux typically reside under /home/, any destructive operation targeting another user's home directory (e.g., /home/otheruser/.ssh/authorized_keys) will silently bypass the workspace boundary check. If /home/ is a legitimate VFS prefix, it needs to be disambiguated from real filesystem paths before the prefix check.
Prompt for AI agents

web/lib/database/migrations/015_users_id_to_text.sql
-- =============================================================================
-- Update all users.id to string format (INTEGER -> TEXT)
UPDATE users SET id = CAST(id AS TEXT);



5 hours ago
P0: This UPDATE ... CAST does not change the column's schema type in SQLite. The declared column type in CREATE TABLE remains unchanged — only the stored values are affected. If id was INTEGER PRIMARY KEY (a rowid alias), this approach is fundamentally incompatible. The table must be recreated with a new schema (as done in migration 014 for the events table).
Prompt for AI agents

packages/shared/cli/launcher.js
});
// Forward exit code
process.exit(result?.status || 0);



5 hours ago
P1: Do not default child-process failures to exit code 0; propagate a non-zero code when status is not a number.
Prompt for AI agents

web/lib/auth/auth-service.ts
      const userId = newUser.id as string;
      // Use the newUser we already fetched
      const user = this.mapDbUserToUser(newUser);



5 hours ago
P1: Double mapDbUserToUser call corrupts the returned user object. user is already mapped at line 348, but line 370 passes it through mapDbUserToUser again. Since the mapped User object doesn't have raw DB field names (is_active, email_verified, created_at), the result will have isActive: false, emailVerified: false, and createdAt: Invalid Date for every newly registered user.
Prompt for AI agents
Suggested change
      const user = this.mapDbUserToUser(newUser);
      const user = newUser; 