/**
 * Unified ID normalization utilities
 * 
 * Provides consistent functions for handling:
 * - userId: "anon:sessionId" for VFS ownership
 * - sessionId: session number (e.g., "001")
 * - scopePath: "project/sessions/001" for file operations
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
 * cookie: "anon_timestamp_random" -> scopePath: "project/sessions/timestamp_random"
 */
export function cookieToScopePath(cookieValue: string, prefix = 'project/sessions'): string {
  const rawId = cookieValue.startsWith('anon_') ? cookieValue.slice(5) : cookieValue;
  return `${prefix}/${rawId}`;
}

/**
 * Extract sessionId from ownerId
 * "anon:timestamp_random" -> "timestamp_random"
 * "1$001" -> "001" (uses FIRST $ to handle user-provided $ in session names)
 */
export function extractSessionIdFromOwnerId(ownerId: string): string {
  if (ownerId.startsWith('anon:')) {
    return ownerId.slice(5);
  }
  // Handle composite: "1$001" -> "001"
  // SECURITY: Use indexOf (FIRST $) not pop(), because:
  // - userId never contains $, but sessionId might (user-provided names)
  if (ownerId.includes('$')) {
    const dollarIndex = ownerId.indexOf('$');
    return ownerId.slice(dollarIndex + 1);
  }
  return ownerId;
}

/**
 * Extract userId from ownerId (without session part)
 * "anon:timestamp_random" -> "anon"
 * "1$001" -> "1" (uses FIRST $ to handle user-provided $ in session names)
 */
export function extractUserIdFromOwnerId(ownerId: string): string {
  if (ownerId.startsWith('anon:')) {
    return 'anon';
  }
  // SECURITY: Use indexOf (FIRST $) not split()[0], because:
  // - userId never contains $, but sessionId might (user-provided names)
  if (ownerId.includes('$')) {
    const dollarIndex = ownerId.indexOf('$');
    return ownerId.slice(0, dollarIndex);
  }
  return ownerId;
}

/**
 * Build scopePath from sessionId
 * "001" -> "project/sessions/001"
 */
export function buildScopePath(sessionId: string, prefix = 'project/sessions'): string {
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