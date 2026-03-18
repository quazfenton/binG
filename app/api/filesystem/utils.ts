/**
 * Filesystem API Utilities
 * 
 * Shared utilities for filesystem API routes
 */

import { NextRequest } from 'next/server';
import { resolveFilesystemOwner, type FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

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
    
    // Even in fallback, try to use the x-anonymous-session-id header for consistency
    const headerAnonId = req.headers.get('x-anonymous-session-id')?.trim();
    if (headerAnonId && headerAnonId.length <= 128) {
      const normalized = headerAnonId.replace(/[^a-zA-Z0-9:_-]/g, '');
      if (normalized) {
        return {
          ownerId: `anon:${normalized}`,
          source: 'anonymous' as const,
          isAuthenticated: false,
        };
      }
    }
    
    return {
      ownerId: 'anon:public',
      source: 'anonymous' as const,
      isAuthenticated: false,
    };
  }
}
