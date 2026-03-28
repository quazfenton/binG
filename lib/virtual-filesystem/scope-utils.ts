/**
 * Strip common sandbox/workspace prefixes from a path.
 *
 * This is the single source of truth for prefix stripping. All subsystems
 * (VFS service, preview panel, terminal, OPFS) must use this function
 * instead of duplicating the regex list.
 *
 * IMPORTANT: This function preserves ownerId:sessionId composite paths in the sessions folder.
 * For example, "project/sessions/1:005/src/game.js" should NOT become "project/sessions/005/src/game.js"
 * The "1:" prefix represents ownerId:sessionId and must be preserved.
 *
 * Handles prefixes like:
 *   /tmp/workspaces/, /workspace/, /home/<user>/workspace/, /sessions/, project/
 */
export function stripWorkspacePrefixes(rawPath: string): string {
  let path = (rawPath || '')
    .replace(/\\/g, '/')
    .trim();

  // CRITICAL FIX: Check for ownerId:sessionId composite path in sessions folder
  // Pattern: project/sessions/{ownerId}:{sessionId}/...
  // We must NOT strip /sessions/ when it contains a composite path like "1:005"
  // The regex below matches and preserves paths like: project/sessions/1:005/src/game.js
  // Also handles paths with leading slash: /project/sessions/1:005/file.js
  
  // Check if path matches sessions/ownerId:sessionId pattern (e.g., project/sessions/1:005/file or /project/sessions/1:005/file)
  // Supports both /project/sessions/ and project/sessions/ (with or without leading slash)
  const sessionsCompositeMatch = path.match(/^(\/?project\/sessions\/)([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)(\/.*)?$/i);
  if (sessionsCompositeMatch) {
    // Preserve the composite ownerId:sessionId format - don't strip anything
    // Remove leading slash if present to normalize to same format
    return path.replace(/^\//, '');
  }

  // Remove accumulated sandbox / workspace prefixes
  // Only strip /sessions/ when it's a simple session ID (no ownerId prefix)
  path = path
    .replace(/^(\/tmp\/workspaces\/)+/gi, '')
    .replace(/^(tmp\/workspaces\/)+/gi, '')
    .replace(/^(\/workspace\/)+/gi, '')
    .replace(/^(workspace\/)+/gi, '')
    .replace(/^(\/home\/[^/]+\/workspace\/)+/gi, '')
    .replace(/^(home\/[^/]+\/workspace\/)+/gi, '')
    // FIX: Only strip /sessions/ prefix if it's NOT followed by ownerId:sessionId composite
    // Use negative lookahead to preserve patterns like "1:005"
    .replace(/^(\/sessions\/(?![a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+))+/gi, '')
    .replace(/^(sessions\/(?![a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+))+/gi, '');

  // Remove any remaining leading slashes
  path = path.replace(/^\/+/, '');

  return path;
}

export function normalizeScopePath(scopePath?: string): string {
  const path = (scopePath || 'project')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  if (!path || path === 'project') {
    return 'project';
  }

  if (path.startsWith('project/')) {
    return path.replace(/\/{2,}/g, '/').replace(/^(project\/)+/i, 'project/');
  }

  return `project/${path}`.replace(/\/{2,}/g, '/');
}

export function resolveScopedPath(requestedPath: string, scopePath?: string): string {
  const scope = normalizeScopePath(scopePath);
  let raw = (requestedPath || '').replace(/\\/g, '/').trim();
  if (!raw) return scope;

  raw = raw.replace(/^\/+/, '');

  if (raw === scope || raw.startsWith(`${scope}/`)) {
    // Always normalize multiple slashes even for scope-matching paths
    return raw.replace(/\/+/g, '/');
  }

  if (raw.startsWith('project/')) {
    return raw.replace(/\/{2,}/g, '/');
  }

  return `${scope}/${raw}`.replace(/\/{2,}/g, '/');
}

export function extractSessionIdFromPath(scopePath?: string): string | null {
  const normalizedPath = normalizeScopePath(scopePath);
  const match = normalizedPath.match(/^project\/sessions\/([^/]+)/i);
  return match?.[1] || null;
}
