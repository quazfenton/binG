/**
 * Unified ID normalization utilities
 * 
 * Provides consistent functions for handling:
 * - userId: "anon:sessionId" for VFS ownership
 * - sessionId: session number (e.g., "001")
 * - scopePath: "workspace/sessions/001" for file operations
 * - Composite IDs: "userId$sessionId" format
 * 
 * SECURITY: Always use these functions instead of manual string construction
 * to prevent IDOR vulnerabilities and session isolation issues.
 */

import { generateSecureId } from '@/lib/utils/server-id';

/**
 * Generate a new anonymous session ID
 * Returns the full ID including "anon_" prefix for cookie storage
 */
export function generateAnonSessionId(): string {
  return generateSecureId('anon'); // Produces 'anon_timestamp_random'
}

/**
 * Convert cookie value to ownerId format
 * cookie: "anon_timestamp_random" -> ownerId: "anon:timestamp_random"
 */
export function cookieToOwnerId(cookieValue: string): string {
  const rawId = cookieValue.startsWith('anon_') ? cookieValue.slice(5) : cookieValue;
  return `anon:${rawId}`;
}

/**
 * Convert cookie value to scopePath format
 * cookie: "anon_timestamp_random" -> scopePath: "workspace/sessions/timestamp_random"
 */
export function cookieToScopePath(cookieValue: string, prefix = 'workspace/sessions'): string {
  const rawId = cookieValue.startsWith('anon_') ? cookieValue.slice(5) : cookieValue;
  return `${prefix}/${rawId}`;
}

/**
 * Extract sessionId from ownerId
 *
 * Format: the sessionId is encoded as the segment AFTER the first `$`
 * delimiter in the ownerId. For composite ownerIds like `user$session` or
 * `anon:USERID$SESSIONID`, the sessionId is whatever comes after `$`.
 *
 * For ownerIds WITHOUT a `$` delimiter, the ownerId does NOT encode a
 * sessionId at all and this function returns `''`.
 *
 * IMPORTANT: for anonymous users, the ownerId is `anon:<USERID>` where
 * `<USERID>` is a unique per-user timestamp+random token (e.g.
 * `anon:1780963912001_a097129a4515a7fa67`). The `<USERID>` is the user's
 * identity, NOT a sessionId. The sessionId is encoded separately — in
 * the scopePath (`workspace/sessions/<sessionId>`) or in a composite
 * ownerId (`anon:<USERID>$<SESSIONID>`).
 *
 * This means the path-drift guard
 * (`assertScopePathMatchesSessionId`) MUST skip its check when the
 * ownerId is a plain `anon:USERID` (no `$`), because the ownerId simply
 * doesn't carry the information needed to detect session drift. The
 * previous implementation incorrectly returned the `<USERID>` portion
 * as the sessionId, which caused every anon write/read/list to be
 * refused as a "path-drift" mismatch against a real session folder
 * like `workspace/sessions/001` (see run.log: 234 "Session id mismatch"
 * errors).
 *
 * @example
 *   extractSessionIdFromOwnerId('anon:1780963912001_a097129a4515a7fa67') // → ''
 *   extractSessionIdFromOwnerId('anon:1780963912001_a097129a4515a7fa67$001') // → '001'
 *   extractSessionIdFromOwnerId('user@domain$001') // → '001'
 *   extractSessionIdFromOwnerId('anon$session_abc') // → 'session_abc'
 *   extractSessionIdFromOwnerId('default') // → '' (no $ → no session encoded)
 *   extractSessionIdFromOwnerId('') // → ''
 */
export function extractSessionIdFromOwnerId(ownerId: string): string {
  if (!ownerId || typeof ownerId !== 'string') return '';
  // SECURITY: Use indexOf (FIRST $) not pop(), because:
  // - userId never contains $, but sessionId might (user-provided names)
  if (ownerId.includes('$')) {
    const dollarIndex = ownerId.indexOf('$');
    return ownerId.slice(dollarIndex + 1);
  }
  // No '$' → ownerId does not encode a sessionId.
  // This is the CORRECT behavior for plain `anon:USERID` (the `<USERID>`
  // is the user's identity, not a sessionId) and for bare strings like
  // `default`. The path-drift guard short-circuits on empty ownerSession.
  return '';
}

/**
 * Extract userId from ownerId (without session part)
 *
 * Returns the part BEFORE the first `$` delimiter, or the whole ownerId
 * if there is no `$`. For `anon:USERID`, the WHOLE string IS the userId
 * (the `anon:` prefix is part of the user identity, not a namespace
 * marker to strip). The sessionId would only be present after a `$`
 * delimiter — for plain `anon:USERID`, no session is encoded.
 *
 * @example
 *   extractUserIdFromOwnerId('anon:1780963912001_a097129a4515a7fa67') // → 'anon:1780963912001_a097129a4515a7fa67'
 *   extractUserIdFromOwnerId('anon:1780963912001_a097129a4515a7fa67$001') // → 'anon:1780963912001_a097129a4515a7fa67'
 *   extractUserIdFromOwnerId('user@domain$001') // → 'user@domain'
 *   extractUserIdFromOwnerId('anon$session_abc') // → 'anon'
 *   extractUserIdFromOwnerId('default') // → 'default'
 *   extractUserIdFromOwnerId('') // → ''
 */
export function extractUserIdFromOwnerId(ownerId: string): string {
  if (!ownerId || typeof ownerId !== 'string') return '';
  // SECURITY: Use indexOf (FIRST $) not split()[0], because:
  // - userId never contains $, but sessionId might (user-provided names)
  if (ownerId.includes('$')) {
    const dollarIndex = ownerId.indexOf('$');
    return ownerId.slice(0, dollarIndex);
  }
  // No '$' → the whole ownerId is the userId (handles both `anon:USERID`
  // and bare strings like `default`).
  return ownerId;
}

/**
 * Build scopePath from sessionId
 * "001" -> "workspace/sessions/001"
 */
export function buildScopePath(sessionId: string, prefix = 'workspace/sessions'): string {
  return `${prefix}/${sessionId}`;
}

/**
 * Build ownerId from sessionId
 * "001" -> "anon:001"
 */
export function buildOwnerId(sessionId: string, prefix = 'anon'): string {
  return `${prefix}:${sessionId}`;
}

// NOTE: buildCompositeSessionId and parseCompositeSessionId have been moved to
// @/lib/identity/composite-session-id.ts which is the canonical location.
// Import from there instead of this file.

/**
 * Normalize session ID to simple folder format
 * Handles: "001", "alpha", "1$004", "anon$004" -> "004"
 */
export function normalizeSessionIdToFolder(sessionId: string): string {
  if (!sessionId || typeof sessionId !== 'string') return '';
  const trimmed = sessionId.trim();
  if (!trimmed) return '';
  if (trimmed.includes('$')) {
    return trimmed.split('$').pop() || trimmed;
  }
  return trimmed;
}

/**
 * Sanitize any string for use in paths (prevents traversal)
 */
export function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

/**
 * Validate that a string is a valid session ID format
 */
export function isValidSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(sessionId);
}

/**
 * Validate that a string is a valid ownerId format
 */
export function isValidOwnerId(ownerId: string): boolean {
  return /^([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/.test(ownerId) ||
         /^[a-zA-Z0-9_-]+$/.test(ownerId);
}