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
 */
export function extractSessionIdFromOwnerId(ownerId: string): string {
  if (ownerId.startsWith('anon:')) {
    return ownerId.slice(5);
  }
  // Handle composite: "1$001" -> "001"
  if (ownerId.includes('$')) {
    return ownerId.split('$').pop() || ownerId;
  }
  return ownerId;
}

/**
 * Extract userId from ownerId (without session part)
 * "anon:timestamp_random" -> "anon"
 * "1$001" -> "1"
 */
export function extractUserIdFromOwnerId(ownerId: string): string {
  if (ownerId.startsWith('anon:')) {
    return 'anon';
  }
  if (ownerId.includes('$')) {
    return ownerId.split('$')[0];
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

/**
 * Parse composite session ID (userId$sessionId format)
 * "1$004" -> { userId: "1", sessionId: "004" }
 * "anon$004" -> { userId: "anon", sessionId: "004" }
 */
export function parseCompositeSessionId(compositeId: string): { userId: string; sessionId: string } | null {
  if (!compositeId.includes('$')) return null;
  const parts = compositeId.split('$');
  return {
    userId: parts[0],
    sessionId: parts[parts.length - 1],
  };
}

/**
 * Build composite session ID
 * userId: "1", sessionId: "004" -> "1$004"
 */
export function buildCompositeSessionId(userId: string, sessionId: string): string {
  return `${userId}$${sessionId}`;
}

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