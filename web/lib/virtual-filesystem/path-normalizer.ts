/**
 * Centralized Path Normalization for VFS
 *
 * Single source of truth for cleaning LLM-provided paths before they reach
 * the VFS layer. Every execution path (MCP tools, agent-filesystem, scope-utils,
 * smart-context display) should delegate here instead of reimplementing.
 *
 * Handles:
 *  - Backslash → forward slash
 *  - Collapse double slashes, strip trailing slashes
 *  - Strip leading `./`
 *  - Strip absolute desktop/CLI workspace root (INITIAL_CWD, DESKTOP_WORKSPACE_ROOT)
 *  - Strip bare Windows drive letter (C:/) in web mode
 *  - Strip redundant VFS scope prefixes (project/sessions/XXX/, sessions/, workspace/sessions/)
 *  - Path traversal rejection
 *
 * @module path-normalizer
 */

// ============================================================================
// Types
// ============================================================================

export interface NormalizePathOptions {
  /** The VFS scope path for this session (e.g. "project/sessions/001"). */
  scopePath?: string;
  /** If true, strip Windows drive letters even when not in desktop mode. Default: true. */
  stripDriveLetters?: boolean;
  /** If true, reject paths containing `..`. Default: true. */
  rejectTraversal?: boolean;
}

export interface NormalizeForDisplayOptions {
  /** If provided, this prefix is stripped first (e.g. "project/sessions/001"). */
  scopePath?: string;
}

// ============================================================================
// Desktop root detection (cached)
// ============================================================================

let _cachedDesktopRoot: string | null | undefined;

function getDesktopRoot(): string | null {
  if (_cachedDesktopRoot !== undefined) return _cachedDesktopRoot;
  if (typeof process !== 'undefined' && process.env) {
    const raw = process.env.INITIAL_CWD || process.env.DESKTOP_WORKSPACE_ROOT;
    if (raw) {
      _cachedDesktopRoot = raw.replace(/\\/g, '/').replace(/\/+$/, '');
      return _cachedDesktopRoot;
    }
  }
  _cachedDesktopRoot = null;
  return null;
}

/** Reset cache (for tests). */
export function _resetDesktopRootCache(): void {
  _cachedDesktopRoot = undefined;
}

// ============================================================================
// Core: clean a raw LLM path into a relative, safe path segment
// ============================================================================

/**
 * Normalize a raw path from LLM output into a clean, relative path segment
 * suitable for prepending a VFS scope path.
 *
 * Does NOT prepend scope — the caller decides whether to scope.
 *
 * @returns A clean relative path (e.g. "src/app.ts"), or throws on fatal issues.
 */
export function normalizeLLMPath(
  inputPath: string,
  opts: NormalizePathOptions = {},
): string {
  const {
    scopePath,
    stripDriveLetters = true,
    rejectTraversal = true,
  } = opts;

  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Path is required');
  }

  // Step 1: Basic normalization
  let p = inputPath
    .replace(/\\/g, '/')      // Backslash → forward slash
    .replace(/\/+/g, '/')     // Collapse double slashes
    .replace(/\/+$/, '');      // Strip trailing slashes

  // Strip leading slash
  if (p.startsWith('/')) p = p.slice(1);

  // Strip leading `./` (repeated)
  while (p.startsWith('./')) p = p.slice(2);

  // Step 2: Strip absolute desktop/CLI workspace root
  const desktopRoot = getDesktopRoot();
  if (desktopRoot) {
    const rootNoSlash = desktopRoot.replace(/^\//, '');
    // Exact prefix match (case-sensitive on Linux, case-insensitive on Windows)
    if (p.startsWith(rootNoSlash + '/')) {
      p = p.slice(rootNoSlash.length + 1);
    } else if (/^[A-Za-z]:/.test(p)) {
      // Case-insensitive Windows drive letter comparison
      const pUpper = p.replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ':');
      const rootUpper = rootNoSlash.replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ':');
      if (pUpper.startsWith(rootUpper + '/')) {
        p = pUpper.slice(rootUpper.length + 1);
      }
    }
  }

  // Step 3: Strip bare Windows drive letter (C:/) — makes path relative
  if (stripDriveLetters && /^[A-Za-z]:\//.test(p)) {
    p = p.replace(/^[A-Za-z]:\//, '');
  }

  // Step 4: Strip redundant VFS scope prefixes
  // Order matters: most specific first, then progressively broader.

  // 4a: If path already starts with the exact scopePath, strip it
  if (scopePath) {
    if (p === scopePath) {
      p = '';
    } else if (p.startsWith(scopePath + '/')) {
      p = p.slice(scopePath.length + 1);
    }
  }

  // 4b: Strip "project/sessions/{anyId}/" prefix (LLM echoing context paths)
  const projectSessionMatch = p.match(/^project\/sessions\/[^/]+\/(.+)$/);
  if (projectSessionMatch) {
    p = projectSessionMatch[1];
  }

  // 4c: Strip "workspace/sessions/{id}/..." prefix
  if (p.startsWith('workspace/sessions/')) {
    const rest = p.slice('workspace/sessions/'.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx !== -1) {
      p = rest.slice(slashIdx + 1);
    }
    // If no slash, it's just "workspace/sessions/001" — leave as-is (will get scoped)
  }

  // 4d: Strip bare "sessions/{id}/..." — but only if it looks like a session ID
  //     (numeric 3-digit, or alphanumeric stock word) followed by more path segments.
  //     This prevents stripping a legitimate folder named "sessions/".
  const sessionsMatch = p.match(/^sessions\/([^/]+)\/(.+)$/);
  if (sessionsMatch) {
    const possibleSessionId = sessionsMatch[1];
    // Only strip if the session ID segment looks like a VFS session ID
    if (/^\d{3}$/.test(possibleSessionId) || /^[a-z]+-?\d*$/i.test(possibleSessionId)) {
      p = sessionsMatch[2];
    }
  }

  // Step 5: Path traversal rejection
  if (rejectTraversal) {
    const segments = p.split('/');
    if (segments.some(seg => seg === '..')) {
      // Best-effort: strip traversal segments instead of throwing
      p = segments.filter(s => s !== '..' && s !== '.').join('/');
    }
  }

  // Strip any remaining leading slashes created by the above steps
  p = p.replace(/^\/+/, '');

  // Final guard: empty path after all stripping
  if (!p || !p.trim()) {
    // Return '.' to indicate "root of scope" rather than throwing
    return '.';
  }

  return p;
}

// ============================================================================
// Display: strip scope prefix for showing paths to LLM
// ============================================================================

/**
 * Strip VFS internal prefixes from a path for display to the LLM.
 * The LLM should see "src/App.tsx", not "project/sessions/001/src/App.tsx".
 *
 * Also strips desktop workspace root if running in desktop mode.
 */
export function stripScopePrefixForDisplay(
  filePath: string,
  opts: NormalizeForDisplayOptions = {},
): string {
  let p = filePath;

  // Strip explicit scope path
  if (opts.scopePath) {
    if (p.startsWith(opts.scopePath + '/')) {
      return p.slice(opts.scopePath.length + 1);
    }
    if (p === opts.scopePath) return '.';
  }

  // Strip "project/sessions/{sessionId}/" prefix
  const match = p.match(/^project\/sessions\/[^/]+\/(.+)$/);
  if (match) return match[1];

  // Strip "project/" prefix as fallback
  if (p.startsWith('project/')) return p.slice('project/'.length);

  // Strip desktop workspace root
  const desktopRoot = getDesktopRoot();
  if (desktopRoot) {
    const rootNoSlash = desktopRoot.replace(/^\//, '');
    if (p.startsWith(rootNoSlash + '/')) {
      return p.slice(rootNoSlash.length + 1);
    }
  }

  return p;
}

// ============================================================================
// Scoped resolution: normalize + prepend scope
// ============================================================================

/**
 * Normalize an LLM path and prepend the VFS scope path.
 * This is the primary function for resolving tool paths to VFS paths.
 *
 * @returns Fully-qualified VFS path (e.g. "project/sessions/001/src/app.ts")
 */
export function resolveToScopedPath(
  inputPath: string,
  scopePath: string,
): string {
  const relative = normalizeLLMPath(inputPath, { scopePath });

  // If normalization returned '.', return the scope root
  if (relative === '.') return scopePath;

  // If the relative path already starts with "project/", it's already fully qualified
  if (relative.startsWith('project/')) return relative;

  return `${scopePath}/${relative}`;
}
