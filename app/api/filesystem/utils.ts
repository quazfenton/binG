/**
 * Filesystem API Utilities
 *
 * Shared utilities for filesystem API routes
 */

import { NextRequest } from 'next/server';
import { resolveFilesystemOwner, type FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { secureRandomId } from '@/lib/utils/crypto-random';

/**
 * Resolve filesystem owner with graceful fallback
 *
 * On first server start or when auth system isn't initialized,
 * returns a fallback anonymous owner instead of throwing.
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

    // PRIORITY 2: Generate new anonymous session ID for first-time visitors (fallback case)
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
