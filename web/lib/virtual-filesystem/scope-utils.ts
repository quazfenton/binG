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
  // Only strip /sessions/ when it follows other sandbox prefixes
  // NEVER strip /sessions/ when it's the primary path component
  path = path
    .replace(/^(\/tmp\/workspaces\/)+/gi, '')
    .replace(/^(tmp\/workspaces\/)+/gi, '')
    .replace(/^(\/workspace\/)+/gi, '')
    .replace(/^(workspace\/)+/gi, '')
    .replace(/^(\/home\/[^/]+\/workspace\/)+/gi, '')
    .replace(/^(home\/[^/]+\/workspace\/)+/gi, '')
    // Only strip /sessions/ when it follows other sandbox prefixes
    .replace(/^(\/tmp\/workspaces\/[^/]*\/sessions\/)/gi, '')
    .replace(/^(\/workspace\/[^/]*\/sessions\/)/gi, '');
  // NOTE: Removed the sessions/ strip regex — sessions/ is a real directory
  // and must never be stripped. /sessions/001 → sessions/001 (preserved).

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
 * Converts: 
 *   project/sessions/anon:1774698249190_p37DQ6WwX:005-1 -> project/sessions/005-1
 *   project/sessions/1774698249190_p37DQ6WwX:002 -> project/sessions/002
 *   anon:1774698249190_p37DQ6WwX:002 -> 002
 *   1774698249190_p37DQ6WwX:002 -> 002
 *
 * This prevents composite IDs from leaking into file paths during LLM refinement
 */
export function sanitizeScopePath(scopePath?: string): string {
  if (!scopePath) return 'project';

  let normalizedPath = normalizeScopePath(scopePath);
  
  // Handle case where scopePath is just a session ID or composite ID without prefix
  // e.g., "002" or "anon:1774...:002" or "1774...:002"
  if (!normalizedPath.includes('/sessions/')) {
    // Check if it's a composite ID format (contains colon)
    if (normalizedPath.includes(':')) {
      const parts = normalizedPath.split(':');
      const lastPart = parts[parts.length - 1];
      // If last part looks like a session ID (3 digits or with suffix), use it
      if (/^\d{3}(-\d+)?$/.test(lastPart) || /^[a-z]+(-\d+)?$/.test(lastPart)) {
        return `project/sessions/${lastPart}`;
      }
    }
    // If it's already a simple session ID, wrap it properly
    if (/^\d{3}(-\d+)?$/.test(normalizedPath) || /^[a-z]+(-\d+)?$/.test(normalizedPath)) {
      return `project/sessions/${normalizedPath}`;
    }
    // Otherwise return as-is (might be "project" or another valid path)
    return normalizedPath;
  }

  const match = normalizedPath.match(/^project\/sessions\/([^/]+)(\/.*)?$/i);

  if (!match) return normalizedPath;

  const sessionIdSegment = match[1];
  const remainingPath = match[2] || '';

  // If segment contains composite ID (ownerId:sessionId), extract only sessionId
  // This ensures folder names like "002" are not corrupted with ownerId prefix
  // e.g., "anon:1774710784761_6TB03h8Ow:002" -> "002"
  // e.g., "1774710784761_6TB03h8Ow:002" -> "002"
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

/**
 * Normalize a session ID to its simple folder name format.
 *
 * CRITICAL: This is the single source of truth for extracting session folder names
 * from potentially composite IDs. Always use this function instead of manual splitting.
 *
 * Purpose: Extract the session folder name from internal composite IDs.
 * This is NOT for generating new session names - use generateSessionName() for that.
 *
 * Handles these formats:
 *   "001" -> "001"
 *   "alpha" -> "alpha"
 *   "001-1" -> "001-1"
 *   "alpha-2" -> "alpha-2"
 *   "anon:1774710784761_6TB03h8Ow:002" -> "002"
 *   "1774710784761_6TB03h8Ow:002" -> "002"
 *   "user123:005" -> "005"
 *   "anon:timestamp_random:alpha-1" -> "alpha-1"
 *
 * Edge cases:
 *   "" -> "" (empty input returns empty, caller decides fallback)
 *   null/undefined -> "" (empty string, caller decides fallback)
 *   "   " -> "" (whitespace only treated as empty)
 *
 * @param sessionId - The session ID (may be simple or composite)
 * @returns The simple session folder name (last segment after any colons), or empty string for invalid input
 */
export function normalizeSessionId(sessionId: string): string {
  // Handle null, undefined, non-string input
  if (!sessionId || typeof sessionId !== 'string') {
    return ''; // Return empty - caller should handle invalid input
  }

  // Trim whitespace
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return ''; // Return empty for whitespace-only input
  }

  // If contains colons (composite ID), extract the last segment
  // This handles formats like:
  // - "anon:timestamp_hash:001" -> "001"
  // - "userId:conversationId:sessionId" -> "sessionId"
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    return parts[parts.length - 1].trim();
  }

  // Already a simple ID - return as-is
  return trimmed;
}

/**
 * Build a normalized session filesystem path.
 *
 * This function ensures that session paths always use simple folder names,
 * never composite IDs. It's the safe way to construct session paths.
 *
 * Examples:
 *   normalizeSessionPath("001") -> "project/sessions/001"
 *   normalizeSessionPath("anon:1774710784761_6TB03h8Ow:002") -> "project/sessions/002"
 *   normalizeSessionPath("alpha-1") -> "project/sessions/alpha-1"
 *
 * @param sessionId - The session ID (may be simple or composite)
 * @param subPath - Optional sub-path within the session (e.g., "src/App.tsx")
 * @returns Normalized filesystem path with simple session folder name
 */
export function normalizeSessionPath(sessionId: string, subPath?: string): string {
  const simpleSessionId = normalizeSessionId(sessionId);
  const basePath = `project/sessions/${simpleSessionId}`;

  if (!subPath) {
    return basePath;
  }

  // Normalize sub-path: remove leading slashes, normalize separators
  const normalizedSubPath = subPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');

  return `${basePath}/${normalizedSubPath}`;
}
