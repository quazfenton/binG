import { normalizeLLMPath } from './path-normalizer';
import { isDesktopMode } from '@bing/platform/env';
import { extractSessionIdFromOwnerId } from './id-normalization';

/**
 * Strip common sandbox/workspace prefixes from a path.
 *
 * This is the single source of truth for prefix stripping. All subsystems
 * (VFS service, preview panel, terminal, OPFS) must use this function
 * instead of duplicating the regex list.
 *
 * IMPORTANT: This function preserves compositeId paths in the sessions folder.
 * For example, "workspace/sessions/1$005/src/game.js" should NOT become "workspace/sessions/005/src/game.js"
 * The "1$" prefix represents userId$sessionId and must be preserved.
 *
 * Handles prefixes like:
 *   /tmp/workspaces/, /workspace/, /home/<user>/workspace/, /sessions/, workspace/
 */
export function stripWorkspacePrefixes(rawPath: string): string {
  let path = (rawPath || '')
    .replace(/\\/g, '/')
    .trim();

  // CRITICAL FIX: Check for compositeId path in sessions folder
  // Pattern: workspace/sessions/{userId}${sessionId}/...
  // We must NOT strip /sessions/ when it contains a composite path like "1$005"
  // The regex below matches and preserves paths like: workspace/sessions/1$005/src/game.js
  // Also handles paths with leading slash: /workspace/sessions/1$005/file.js

  // Check if path matches sessions/compositeId pattern (e.g., workspace/sessions/1$005/file or /workspace/sessions/1$005/file)
  // Supports both /workspace/sessions/ and workspace/sessions/ (with or without leading slash)
  const sessionsCompositeMatch = path.match(/^(\/?workspace\/sessions\/)([a-zA-Z0-9_-]+)\$([a-zA-Z0-9_-]+)(\/.*)?$/i);
  if (sessionsCompositeMatch) {
    // Preserve the composite format - don't strip anything
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

  // Desktop/CLI: Strip absolute real-filesystem prefixes set by INITIAL_CWD / process.cwd()
  // LLMs in desktop mode may echo back paths like "C:\Users\user\workspace\src\app.ts"
  // or "/home/user/workspace/src/app.ts" which should become just "src/app.ts"
  if (typeof process !== 'undefined' && process.env) {
    const desktopRoot = process.env.INITIAL_CWD || process.env.DESKTOP_WORKSPACE_ROOT;
    if (desktopRoot) {
      const rootNorm = desktopRoot.replace(/\\/g, '/').replace(/\/+$/, '');
      if (rootNorm && path.startsWith(rootNorm + '/')) {
        path = path.slice(rootNorm.length + 1);
      }
      // Case-insensitive for Windows drive letters
      if (rootNorm && /^[A-Za-z]:/.test(path)) {
        const pathUpper = path.replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ':');
        const rootUpper = rootNorm.replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ':');
        if (pathUpper.startsWith(rootUpper + '/')) {
          path = pathUpper.slice(rootUpper.length + 1);
        }
      }
    }
  }

  // Remove any remaining leading slashes
  path = path.replace(/^\/+/, '');

  return path;
}

export function normalizeScopePath(scopePath?: string): string {
  const path = (scopePath || 'workspace')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  if (!path || path === 'workspace') {
    return 'workspace';
  }

  if (path.startsWith('workspace/')) {
    return path.replace(/\/{2,}/g, '/').replace(/^(workspace\/)+/i, 'workspace/');
  }

  return `workspace/${path}`.replace(/\/{2,}/g, '/');
}

export function resolveScopedPath(requestedPath: string, scopePath?: string): string {
  const scope = normalizeScopePath(scopePath);
  if (!requestedPath || !requestedPath.trim()) return scope;

  const relative = normalizeLLMPath(requestedPath, { scopePath: scope, rejectTraversal: true });

  // '.' means "root of scope" after all stripping
  if (relative === '.') return scope;

  // Validate fully-qualified workspace paths are within the expected scope to prevent scope escape
  if (relative.startsWith('workspace/')) {
    if (relative.startsWith(scope + '/') || relative === scope) {
      return relative;
    }
    throw new Error(`Path "${relative}" is outside the allowed scope "${scope}"`);
  }

  return `${scope}/${relative}`;
}

export function extractSessionIdFromPath(scopePath?: string): string | null {
  const normalizedPath = normalizeScopePath(scopePath);
  const match = normalizedPath.match(/^workspace\/sessions\/([^/]+)/i);
  if (!match) return null;

  const sessionIdSegment = match[1];

  // CRITICAL FIX: Handle composite format
  // If the segment contains a $ (e.g., "1$004"),
  // extract only the actual session ID part after the last $
  if (sessionIdSegment.includes('$')) {
    const dollarIndex = sessionIdSegment.lastIndexOf('$');
    return sessionIdSegment.slice(dollarIndex + 1);
  }

  return sessionIdSegment;
}

/**
 * Sanitize scope path to remove any userId prefix from composite IDs
 *
 * Converts:
 *   workspace/sessions/1$004 -> workspace/sessions/004
 *   1$004 -> 004
 *
 * This prevents composite IDs from leaking into file paths during LLM refinement
 */
export function sanitizeScopePath(scopePath?: string): string {
  if (!scopePath) return 'workspace';

  let normalizedPath = normalizeScopePath(scopePath);

  // Handle case where scopePath is just a session ID or composite ID without prefix
  // e.g., "002" or "1$002"
  if (!normalizedPath.includes('/sessions/')) {
    // Check if it's a composite ID format (contains $)
    if (normalizedPath.includes('$')) {
      const dollarIndex = normalizedPath.lastIndexOf('$');
      const lastPart = normalizedPath.slice(dollarIndex + 1);
      // If last part looks like a session ID (3 digits or with suffix), use it
      if (/^\d{3}(-\d+)?$/.test(lastPart) || /^[a-z]+(-\d+)?$/.test(lastPart)) {
        return `workspace/sessions/${lastPart}`;
      }
    }
    // If it's already a simple session ID, wrap it properly
    if (/^\d{3}(-\d+)?$/.test(normalizedPath) || /^[a-z]+(-\d+)?$/.test(normalizedPath)) {
      return `workspace/sessions/${normalizedPath}`;
    }
    // Otherwise return as-is (might be "workspace" or another valid path)
    return normalizedPath;
  }

  const match = normalizedPath.match(/^workspace\/sessions\/([^/]+)(\/.*)?$/i);

  if (!match) return normalizedPath;

  const sessionIdSegment = match[1];
  const remainingPath = match[2] || '';

  // If segment contains composite ID (userId$sessionId), extract only sessionId
  // This ensures folder names like "002" are not corrupted with userId prefix
  if (sessionIdSegment.includes('$')) {
    const dollarIndex = sessionIdSegment.lastIndexOf('$');
    const actualSessionId = sessionIdSegment.slice(dollarIndex + 1);
    return `workspace/sessions/${actualSessionId}${remainingPath}`;
  }

  return normalizedPath;
}

/**
 * Extracts the scope path (parent directory) from a file path.
 * Used for cache invalidation to notify the correct directory after file operations.
 *
 * Examples:
 *   "workspace/sessions/002/src/App.tsx" -> "workspace/sessions/002"
 *   "workspace/sessions/002/package.json" -> "workspace/sessions/002"
 *   "workspace/package.json" -> "workspace"
 */
export function extractScopePath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 1
    ? parts.slice(0, parts.length - 1).join('/')
    : parts[0] || 'workspace';
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
 *   "1$004" -> "004"
 *   "anon$004" -> "004"
 *
 * Edge cases:
 *   "" -> "" (empty input returns empty, caller decides fallback)
 *   null/undefined -> "" (empty string, caller decides fallback)
 *   "   " -> "" (whitespace only treated as empty)
 *
 * @param sessionId - The session ID (may be simple or composite)
 * @returns The simple session folder name (last segment after any $), or empty string for invalid input
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

  // Handle composite IDs: owner$session or anon:session
  if (trimmed.startsWith('anon:')) {
    return trimmed.slice('anon:'.length).trim();
  }

  const dollarIndex = trimmed.indexOf('$');
  if (dollarIndex !== -1) {
    return trimmed.slice(dollarIndex + 1).trim();
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex !== -1) {
    return trimmed.slice(colonIndex + 1).trim();
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
 *   normalizeSessionPath("001") -> "workspace/sessions/001"
 *   normalizeSessionPath("1$004") -> "workspace/sessions/004"
 *   normalizeSessionPath("alpha-1") -> "workspace/sessions/alpha-1"
 *
 * @param sessionId - The session ID (may be simple or composite)
 * @param subPath - Optional sub-path within the session (e.g., "src/App.tsx")
 * @returns Normalized filesystem path with simple session folder name
 */
export function normalizeSessionPath(sessionId: string, subPath?: string): string {
  const simpleSessionId = normalizeSessionId(sessionId);
  const basePath = `workspace/sessions/${simpleSessionId}`;

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

/**
 * Get the VFS scope base path for the current execution mode.
 * In desktop/CLI mode, users can choose arbitrary workspace directories,
 * so we use 'workspace' as the VFS root namespace.
 * In web mode, we use 'workspace/sessions/{sessionId}' for session isolation.
 * 
 * @param sessionId - Optional session ID for web mode
 * @returns The appropriate VFS scope base path
 */
/**
 * The default fallback scopePath returned by getVfsScopeBasePath() when
 * no sessionId is provided in web mode. This is a SENTINEL value meaning
 * "no session provided" — it is NOT a real session folder, and the path
 * guard (assertScopePathMatchesSessionId) must skip its check when it sees
 * this value to avoid false-positive SessionPathMismatchError on app open.
 */
export const DEFAULT_FALLBACK_SCOPE_PATH = 'workspace/sessions/000';

export function getVfsScopeBasePath(sessionId?: string): string {
  if (isDesktopMode()) {
    // Desktop/CLI mode: use 'workspace' as VFS root - users choose their own workspace
    return 'workspace';
  }
  // Web mode: use session-scoped path
  if (sessionId) {
    const simpleSessionId = normalizeSessionId(sessionId);
    return `workspace/sessions/${simpleSessionId}`;
  }
  return DEFAULT_FALLBACK_SCOPE_PATH; // Default fallback for web mode without session
}

/**
 * Detect if a rename would drop the session id segment of a VFS scope path.
 *
 * The session id is the segment immediately under `workspace/sessions/`. A
 * rename that REPLACES this segment with a non-session-id value (e.g. a
 * project name like `ai_terminal`) breaks the session boundary — every
 * subsequent tool call that scopes to `workspace/sessions/<id>` can no
 * longer find the session files, causing the user-perceived "session
 * rename" bug where files appear to vanish and a stray folder replaces
 * the real session.
 *
 * Rules (both source and dest must be under `workspace/sessions/`):
 *   1. If the source session segment is a valid session id
 *      (3-digit numeric, or a stock word like `alpha`, `alpha-1`) and
 *   2. The dest session segment is NOT a valid session id, and is not
 *      equal to the source session id (no-op rename),
 *   → returns the dropped session id; the rename should be rejected.
 *
 * If the source is not under `workspace/sessions/`, this is not a
 * session-scope rename and the function returns null (caller may proceed).
 *
 * @returns The session id that would be lost, or null if no loss.
 *
 * @example
 *   wouldLoseSessionId(
 *     'workspace/sessions/001',
 *     'workspace/sessions/ai_terminal',
 *   ) // → '001'
 *
 *   wouldLoseSessionId(
 *     'workspace/sessions/alpha-1/src',
 *     'workspace/sessions/portfolio-app/src',
 *   ) // → 'alpha-1'
 *
 *   wouldLoseSessionId(
 *     'workspace/sessions/001/src',
 *     'workspace/sessions/002/src',
 *   ) // → null (legitimate cross-session move)
 */
export function wouldLoseSessionId(
  sourcePath: string,
  destinationPath: string,
): string | null {
  const SESSION_SEGMENT_RE = /^[a-z0-9_-]+$/i;
  const SESSION_ID_RE = /^(\d{3}(-\d+)?|[a-z]+-?\d*)$/i;

  const norm = (p: string): string =>
    (p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

  const src = norm(sourcePath);
  const dest = norm(destinationPath);

  if (!src || !dest) return null;
  if (src === dest) return null; // no-op

  const srcMatch = src.match(/^workspace\/sessions\/([^/]+)(\/.*)?$/i);
  const destMatch = dest.match(/^workspace\/sessions\/([^/]+)(\/.*)?$/i);

  // If either side isn't under workspace/sessions/, not a session-scope rename.
  if (!srcMatch || !destMatch) return null;

  const srcSession = srcMatch[1];
  const destSession = destMatch[1];

  // Same id — no loss (legitimate rename within the same session).
  if (srcSession === destSession) return null;

  // Both must look like path segments (defensive — should always be true here).
  if (!SESSION_SEGMENT_RE.test(srcSession) || !SESSION_SEGMENT_RE.test(destSession)) {
    return null;
  }

  // Source is a session id AND destination is not — this is the bug.
  if (SESSION_ID_RE.test(srcSession) && !SESSION_ID_RE.test(destSession)) {
    return srcSession;
  }

  return null;
}

/**
 * Get the VFS scope path, preferring explicit sessionId over inferred.
 * This is the recommended function for getting scopePath in MCP tools.
 *
 * @param options - Object with sessionId and optional override scopePath
 * @returns The appropriate VFS scope path
 */
export function getVfsScopePath(options: { sessionId?: string; scopePath?: string }): string {
  const { sessionId, scopePath } = options;
  // If explicitly passed scopePath and it's the session-scoped form, use it
  if (scopePath && scopePath.startsWith('workspace/sessions/')) {
    return scopePath;
  }
  // If scopePath is explicitly 'workspace' (no session context), preserve it as-is
  // This preserves the web fallback behavior when sessionId is empty
  if (scopePath === 'workspace') {
    return 'workspace';
  }
  // Otherwise derive from sessionId with mode awareness
  return getVfsScopeBasePath(sessionId);
}

/**
 * Resolve a scopePath against an ownerId. If the provided scopePath is the
 * default fallback (workspace/sessions/000) AND the ownerId encodes a real
 * session, return a scopePath derived from the ownerId's session. Otherwise
 * return the scopePath unchanged.
 *
 * IMPORTANT (Bug #26 hot-fix): the ownerId is considered to "encode a
 * session" ONLY when it contains a `$` delimiter (e.g. `user$001` or
 * `anon:USERID$001`). For plain `anon:USERID` ownerIds, NO session is
 * encoded — the `USERID` portion is the user's identity, not a session.
 * Such ownerIds get the default fallback kept unchanged; the session is
 * expected to be determined by the request context (not derived from the
 * userId). The previous behavior of deriving a session from the userId
 * portion of `anon:USERID` caused 234 false-positive `SessionPathMismatch`
 * errors in run.log.
 *
 * @param ownerId   VFS owner id (e.g. `anon:1780963912001_a097129a4515a7fa67`)
 * @param scopePath The request's scopePath (may be the default fallback)
 * @returns The resolved scopePath, derived from ownerId if the fallback was used
 *
 * @example
 *   resolveScopePathFromOwnerId('anon:1780963912001_a097129a4515a7fa67', 'workspace/sessions/000')
 *   // → 'workspace/sessions/000' (no `$` → no session encoded; USERID is identity, not session)
 *
 *   resolveScopePathFromOwnerId('anon:1780963912001_a097129a4515a7fa67$001', 'workspace/sessions/000')
 *   // → 'workspace/sessions/001' (composite with `$` → session is derived)
 *
 *   resolveScopePathFromOwnerId('user@domain$001', 'workspace/sessions/000')
 *   // → 'workspace/sessions/001'
 *
 *   resolveScopePathFromOwnerId('anon:abc123', 'workspace/sessions/001')
 *   // → 'workspace/sessions/001' (not the fallback, returned as-is)
 */
export function resolveScopePathFromOwnerId(
  ownerId: string,
  scopePath: string | undefined,
): string {
  if (!scopePath) return scopePath || 'workspace';
  const normalized = normalizeScopePath(scopePath);
  if (normalized === 'workspace') return normalized; // root scope, no session
  if (normalized !== DEFAULT_FALLBACK_SCOPE_PATH) return normalized; // not the fallback

  // The scopePath IS the default fallback. Try to derive a real session
  // from the ownerId. If the ownerId encodes a session, use it; otherwise
  // keep the fallback (the guard will skip its check anyway since there's
  // no ownerSession to compare against).
  // Reuse the canonical extraction from id-normalization.ts — single source of
  // truth for ownerId parsing. Handles `anon:<id>`, `anon$<id>`, `<user>$<session>`,
  // and other formats produced by the auth layer.
  const ownerSession = ownerId ? extractSessionIdFromOwnerId(ownerId) : null;
  if (ownerSession) {
    return `workspace/sessions/${normalizeSessionId(ownerSession)}`;
  }
  return normalized;
}


/**
 * Resolve the scope segment within a filePath. If the filePath starts with
 * the default fallback (workspace/sessions/000/...) AND the ownerId encodes
 * a real session (contains a `$` delimiter), rewrite the scope segment to
 * the ownerId's session. Otherwise return the filePath unchanged.
 *
 * IMPORTANT (Bug #26 hot-fix): the ownerId is considered to "encode a
 * session" ONLY when it contains a `$` delimiter. For plain `anon:USERID`
 * ownerIds, no session is encoded and the filePath is returned unchanged
 * (it stays at the default fallback scope). See
 * `resolveScopePathFromOwnerId` for the full rationale.
 *
 * @param ownerId   VFS owner id
 * @param filePath  The file path (may start with the default fallback scope)
 * @returns The resolved filePath
 */
export function resolveFilePathScopeFromOwnerId(
  ownerId: string,
  filePath: string | undefined,
): string {
  if (!filePath) return filePath || '';
  const ownerSession = ownerId ? extractSessionIdFromOwnerId(ownerId) : null;
  if (!ownerSession) return filePath;
  // Check if filePath starts with the default fallback scope
  if (filePath === DEFAULT_FALLBACK_SCOPE_PATH ||
      filePath.startsWith(DEFAULT_FALLBACK_SCOPE_PATH + '/')) {
    return filePath.replace(
      DEFAULT_FALLBACK_SCOPE_PATH,
      `workspace/sessions/${ownerSession}`,
      1
    );
  }
  return filePath;
}
