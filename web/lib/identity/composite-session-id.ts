/**
 * Composite Session ID Utilities
 *
 * Centralized utilities for working with composite session IDs (userId$sessionId format).
 * This module ensures consistent handling of session identity across ALL subsystems:
 * - VFS operations
 * - Shadow commits
 * - Tool context
 * - MCP tools
 * - Database queries
 * - Authentication/authorization
 * - File path construction
 *
 * Format: `${userId}$${sessionId}` (e.g., "1$004", "anon$alpha-2")
 *
 * @module
 */

// ============================================
// Types
// ============================================

export interface CompositeSessionId {
  /** Full composite ID (e.g., "1$004", "anon$alpha") */
  composite: string;
  /** User ID part (e.g., "1", "anon:xyz") */
  userId: string;
  /** Simple session folder name (e.g., "004", "alpha") */
  simpleSessionId: string;
  /** Filesystem scope path (e.g., "project/sessions/004") */
  scopePath: string;
}

// ============================================
// Parsing & Construction
// ============================================

/**
 * Parse a composite session ID into its components.
 *
 * @param input - May be composite ("1$004") or simple ("004")
 * @param defaultUserId - Fallback userId if input is simple (e.g., "anon")
 * @returns Parsed composite session ID object
 */
export function parseCompositeSessionId(
  input: string | undefined,
  defaultUserId: string = 'anon',
): CompositeSessionId {
  if (!input || !input.trim()) {
    const composite = `${defaultUserId}$000`;
    return {
      composite,
      userId: defaultUserId,
      simpleSessionId: '000',
      scopePath: 'project/sessions/000',
    };
  }

  const trimmed = input.trim();

  if (trimmed.includes('$')) {
    // Composite format: userId$sessionId
    const lastDollarIndex = trimmed.lastIndexOf('$');
    const userId = trimmed.slice(0, lastDollarIndex);
    const simpleSessionId = trimmed.slice(lastDollarIndex + 1);

    return {
      composite: trimmed,
      userId,
      simpleSessionId,
      scopePath: `project/sessions/${simpleSessionId}`,
    };
  }

  // Simple format: just sessionId
  return {
    composite: `${defaultUserId}$${trimmed}`,
    userId: defaultUserId,
    simpleSessionId: trimmed,
    scopePath: `project/sessions/${trimmed}`,
  };
}

/**
 * Build a composite session ID from userId and sessionId.
 *
 * @param userId - User identifier (e.g., "1", "anon:xyz")
 * @param sessionId - Simple session identifier (e.g., "004", "alpha")
 * @returns Composite ID string (e.g., "1$004")
 */
export function buildCompositeSessionId(
  userId: string,
  sessionId: string,
): string {
  if (!userId || !sessionId) {
    throw new Error('Both userId and sessionId are required to build composite session ID');
  }
  return `${userId}$${sessionId}`;
}

/**
 * Extract the simple session folder name from a composite ID.
 *
 * SECURITY: Uses indexOf (FIRST $) not lastIndexOf, because:
 * - userId is system-controlled and NEVER contains $
 * - sessionId MAY contain user-provided $ (e.g., folder named "my$project")
 * - The FIRST $ is always our system separator
 *
 * @param input - Composite ("1$004") or simple ("004")
 * @returns Simple session folder name (e.g., "004")
 */
export function extractSimpleSessionId(input: string | undefined): string {
  if (!input || !input.trim()) return '000';

  const trimmed = input.trim();
  // CRITICAL: Use indexOf (FIRST $) — userId never contains $, but sessionId might
  const dollarIndex = trimmed.indexOf('$');

  if (dollarIndex !== -1) {
    return trimmed.slice(dollarIndex + 1) || trimmed;
  }

  return trimmed;
}

/**
 * Extract the user ID part from a composite session ID.
 *
 * SECURITY: Uses indexOf (FIRST $) not lastIndexOf, because:
 * - userId is system-controlled and NEVER contains $
 * - sessionId MAY contain user-provided $ (e.g., folder named "my$project")
 * - The FIRST $ is always our system separator
 *
 * @param input - Composite ("1$004") or simple ("004")
 * @param defaultUserId - Fallback if input is simple
 * @returns User ID (e.g., "1", "anon:xyz")
 */
export function extractUserIdFromComposite(
  input: string | undefined,
  defaultUserId: string = 'anon',
): string {
  if (!input || !input.trim()) return defaultUserId;

  const trimmed = input.trim();

  if (trimmed.includes('$')) {
    // CRITICAL: Use indexOf (FIRST $) — userId never contains $
    const dollarIndex = trimmed.indexOf('$');
    return trimmed.slice(0, dollarIndex);
  }

  // Simple ID - return default since we don't know the user
  return defaultUserId;
}

// ============================================
// Path Construction
// ============================================

/**
 * Build a filesystem scope path from a session ID.
 *
 * ALWAYS returns `project/sessions/{simpleSessionId}` format.
 * Never includes $ in the path.
 *
 * @param input - Composite ("1$004") or simple ("004")
 * @returns Scope path (e.g., "project/sessions/004")
 */
export function buildScopePath(input: string | undefined): string {
  const simpleId = extractSimpleSessionId(input);
  // Guard against empty string from extractSimpleSessionId
  return `project/sessions/${simpleId || '000'}`;
}

/**
 * Build a full file path scoped to a session.
 *
 * @param input - Composite or simple session ID
 * @param relativePath - File path relative to session root
 * @returns Full scoped path (e.g., "project/sessions/004/src/App.tsx")
 */
export function buildScopedFilePath(
  input: string | undefined,
  relativePath: string,
): string {
  if (!relativePath || !relativePath.trim()) {
    return buildScopePath(input);
  }

  const scopePath = buildScopePath(input);
  const cleanRelative = relativePath
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');

  return `${scopePath}/${cleanRelative}`;
}

// ============================================
// Validation
// ============================================

/**
 * Validate a session ID (composite or simple).
 *
 * Allows: letters, numbers, $, :, _, -
 * Rejects: empty, too long, path traversal
 *
 * @param input - Session ID to validate
 * @returns true if valid
 */
export function isValidSessionId(input: string | undefined): boolean {
  if (!input || !input.trim()) return false;

  const trimmed = input.trim();
  if (trimmed.length > 200) return false;
  if (trimmed.includes('..') || trimmed.includes('//')) return false;

  // Allow composite and simple formats
  return /^[a-zA-Z0-9:_$-]+$/.test(trimmed);
}

/**
 * Check if an ID is in composite format.
 */
export function isCompositeSessionId(input: string | undefined): boolean {
  return !!input && input.includes('$');
}

// ============================================
// Database Query Helpers
// ============================================

/**
 * Build a shadow commit query key.
 *
 * Shadow commits store the FULL owner string as session_id.
 * This ensures consistent query keys across all code paths.
 *
 * @param ownerId - Owner ID (e.g., "anon:xyz")
 * @param sessionId - Session ID (composite or simple)
 * @returns Query key for shadow_commits table
 */
export function buildShadowCommitKey(
  ownerId: string,
  sessionId: string,
): string {
  // If sessionId is already composite, use it directly
  if (isCompositeSessionId(sessionId)) {
    return sessionId;
  }

  // Otherwise build composite from ownerId + sessionId
  return `${ownerId}$${sessionId}`;
}

/**
 * Extract the shadow commit query key from a composite session ID.
 *
 * When querying shadow_commits, you need the FULL composite key
 * that was used when the commit was stored.
 *
 * @param compositeSessionId - e.g., "1$004" or "anon:xyz$004"
 * @returns Key to use in WHERE session_id = ?
 */
export function extractShadowCommitKey(compositeSessionId: string): string {
  // Shadow commits store the full composite as session_id
  return compositeSessionId;
}

// ============================================
// Tool Context Helpers
// ============================================

export interface ToolContextIdentity {
  /** userId for auth/ownership */
  userId: string;
  /** Composite sessionId for session-scoped operations */
  sessionId: string;
  /** Simple scope path for file operations */
  scopePath: string;
}

/**
 * Build complete tool context identity from a session ID.
 *
 * Use this when calling toolContextStore.run() or similar.
 *
 * @param input - Composite or simple session ID
 * @param defaultUserId - Fallback userId if simple format
 * @returns Complete tool context identity
 */
export function buildToolContextIdentity(
  input: string | undefined,
  defaultUserId: string = 'anon',
): ToolContextIdentity {
  const parsed = parseCompositeSessionId(input, defaultUserId);

  return {
    userId: parsed.userId,
    sessionId: parsed.composite, // Use composite for session-scoped ops
    scopePath: parsed.scopePath, // Use simple for file paths
  };
}
