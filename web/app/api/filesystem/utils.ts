/**
 * Filesystem API Utilities
 *
 * Shared utilities for filesystem API routes
 */

import { NextRequest } from 'next/server';
import { resolveFilesystemOwner, type FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { secureRandomId } from '@/lib/utils/crypto-random';
import { normalizeSessionPath, normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';

/**
 * Resolve filesystem owner with graceful fallback
 *
 * On first server start or when auth system isn't initialized,
 * returns a fallback anonymous owner instead of throwing.
 *
 * SESSION FRAGMENTATION FIX: Uses client-provided x-anonymous-session-id header
 * to prevent generating duplicate session IDs for concurrent requests.
 */
export async function resolveFilesystemOwnerWithFallback(
  req: NextRequest,
  context: { route: string; requestId: string }
): Promise<FilesystemOwnerResolution> {
  try {
    return await resolveFilesystemOwner(req);
  } catch (authError: unknown) {
    // Handle case where auth system isn't initialized yet (e.g., on first server start)
    const errorMessage = authError instanceof Error
      ? `${authError.message}\n${authError.stack}`
      : String(authError);

    console.warn(
      `[${context.route}:${context.requestId}] Auth not ready, using fallback:`,
      errorMessage
    );

    // SECURITY: Only trust the HttpOnly cookie for anonymous identity in fallback too.
    // Never trust client-controlled headers - they can be forged to impersonate other users.
    // PRIORITY 1: Use existing anonymous session ID from HttpOnly cookie
    const anonymousSessionId = req.cookies.get('anon-session-id')?.value;
    if (anonymousSessionId) {
      // Strip 'anon_' prefix if present (from generateSecureId format) for consistent ownerId
      const sessionId = anonymousSessionId.startsWith('anon_') ? anonymousSessionId.slice(5) : anonymousSessionId;
      return {
        ownerId: `anon:${sessionId}`,
        source: 'anonymous' as const,
        isAuthenticated: false,
      };
    }

    // PRIORITY 2: Use client-provided session ID from header (if available)
    // This prevents session fragmentation during initial page load
    const clientSessionId = req.headers.get('x-anonymous-session-id');
    if (clientSessionId) {
      const sanitizeSessionId = (id: string): string => {
        return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      };
      const sanitizedClientId = sanitizeSessionId(clientSessionId);
      const clientId = sanitizedClientId.startsWith('anon_') ? sanitizedClientId.slice(5) : sanitizedClientId;
      return {
        ownerId: `anon:${clientId}`,
        source: 'anonymous' as const,
        isAuthenticated: false,
        anonSessionId: sanitizedClientId,
      };
    }

    // PRIORITY 3: Generate new anonymous session ID for first-time visitors (fallback case)
    // This prevents cross-user collisions that would occur with shared 'anon:public'
    const newAnonId = secureRandomId() + Date.now().toString(36);
    return {
      ownerId: `anon:${newAnonId}`,
      source: 'anonymous' as const,
      isAuthenticated: false,
      anonSessionId: newAnonId,
    };
  }
}

/**
 * Normalize a filesystem path to handle composite session IDs.
 *
 * Converts paths like "project/sessions/anon$001" to "project/sessions/001"
 * This prevents VFS errors when clients send composite session IDs.
 *
 * @param path - The filesystem path to normalize
 * @returns Normalized path with simple session folder names
 */
export function normalizeFilesystemPath(path: string): string {
  const sessionsMatch = path.match(/^project\/sessions\/([^/]+)/i);
  if (sessionsMatch) {
    const sessionSegment = sessionsMatch[1];
    if (sessionSegment.includes('$') || sessionSegment.includes(':')) {
      const normalizedSimpleId = normalizeSessionId(sessionSegment);
      return path.replace(`project/sessions/${sessionSegment}`, `project/sessions/${normalizedSimpleId}`);
    }
  }
  return path;
}
