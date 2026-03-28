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
  if (!match) return null;

  const sessionIdSegment = match[1];

  // CRITICAL FIX: Handle composite ownerId:sessionId format
  // If the segment contains a colon (e.g., "anon:1774698249190_p37DQ6WwX:005-1"),
  // extract only the actual session ID part after the last colon
  if (sessionIdSegment.includes(':')) {
    const parts = sessionIdSegment.split(':');
    return parts[parts.length - 1]; // Return the last part (actual session ID)
  }

  return sessionIdSegment;
}

/**
 * Sanitize scope path to remove any ownerId prefix from composite IDs
 * 
 * Converts: project/sessions/anon:1774698249190_p37DQ6WwX:005-1
 * To:       project/sessions/005-1
 * 
 * This prevents composite IDs from leaking into file paths during LLM refinement
 */
export function sanitizeScopePath(scopePath?: string): string {
  if (!scopePath) return 'project';
  
  const normalizedPath = normalizeScopePath(scopePath);
  const match = normalizedPath.match(/^project\/sessions\/([^/]+)(\/.*)?$/i);
  
  if (!match) return normalizedPath;
  
  const sessionIdSegment = match[1];
  const remainingPath = match[2] || '';
  
  // If segment contains composite ID (ownerId:sessionId), extract only sessionId
  // This ensures folder names like "002" are not corrupted with ownerId prefix
  // e.g., "anon:1774710784761_6TB03h8Ow:002" -> "002"
  if (sessionIdSegment.includes(':')) {
    const parts = sessionIdSegment.split(':');
    const actualSessionId = parts[parts.length - 1]; // Get the last part (folder name)
    return `project/sessions/${actualSessionId}${remainingPath}`;
  }
  
  return normalizedPath;
}

/**
 * Extracts the scope path (parent directory) from a file path.
 * Used for cache invalidation to notify the correct directory after file operations.
 * 
 * Examples:
 *   "project/sessions/002/src/App.tsx" -> "project/sessions/002"
 *   "project/sessions/002/package.json" -> "project/sessions/002"
 *   "project/package.json" -> "project"
 */
export function extractScopePath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 1 
    ? parts.slice(0, parts.length - 1).join('/')
    : parts[0] || 'project';
}
