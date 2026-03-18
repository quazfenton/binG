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
    
    return {
      ownerId: 'anon:public',
      source: 'fallback',
      isAuthenticated: false,
    };
  }
}
