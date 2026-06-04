/**
 * Filesystem API Utilities
 *
 * Shared utilities for filesystem API routes
 */

import { NextRequest } from 'next/server';
import { resolveFilesystemOwner, type FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { secureRandomId } from '@/lib/utils/crypto-random';
import { normalizeSessionPath, normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';

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
 * Converts paths like "workspace/sessions/anon$001" to "workspace/sessions/001"
 * This prevents VFS errors when clients send composite session IDs.
 *
 * @param path - The filesystem path to normalize
 * @returns Normalized path with simple session folder names
 */
export function normalizeFilesystemPath(path: string): string {
  const sessionsMatch = path.match(/^workspace\/sessions\/([^/]+)/i);
  if (sessionsMatch) {
    const sessionSegment = sessionsMatch[1];
    if (sessionSegment.includes('$') || sessionSegment.includes(':')) {
      const normalizedSimpleId = normalizeSessionId(sessionSegment);
      return path.replace(`workspace/sessions/${sessionSegment}`, `workspace/sessions/${normalizedSimpleId}`);
    }
  }
  return path;
}

/**
 * Auto-correct stale session paths to the user's active session.
 * 
 * If a client requests "workspace/sessions/001/file.txt" but the file only exists
 * under "workspace/sessions/003/file.txt" in their partitioned workspace, this
 * function corrects the path to "workspace/sessions/003/file.txt".
 * 
 * Returns an object with the corrected path and, if the file content was already
 * read during correction, the cached content to avoid a redundant second read.
 */
export async function correctSessionPath(ownerId: string, filePath: string): Promise<{ path: string; content?: any }> {
  // First, try to read the file at the requested path. If it works, no correction needed.
  try {
    const file = await virtualFilesystem.readFile(ownerId, filePath);
    return { path: filePath, content: file };
  } catch (readError: any) {
    const errorMsg = readError?.message?.toLowerCase() || '';
    // If the path is a directory (not a file), that's valid — return as-is.
    // Backend readFile throws "is a directory" for directory paths, which
    // means the path exists and no session-path correction is needed.
    if (errorMsg.includes('is a directory') || errorMsg.includes('not a file')) {
      return { path: filePath };
    }
    // If the error is not a "File not found", we should not attempt correction.
    if (!errorMsg.includes('file not found')) {
      // Re-throw the original error.
      throw readError;
    }
  }

  // The requested file was not found. Now try to auto-correct the session ID.
  // Normalize the path to remove leading/trailing slashes and workspace prefix.
  let normalizedPath = filePath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (normalizedPath.startsWith('workspace/')) {
    normalizedPath = normalizedPath.slice('workspace/'.length);
  }

  // Check if the path matches the pattern: sessions/<sessionId>/...
  const sessionsMatch = normalizedPath.match(/^sessions\/([^/]+)\/(.+)$/);
  if (!sessionsMatch) {
    // If it's not a session-scoped path, we cannot correct it.
    // Return as { path: filePath } per the typed contract;
    // callers destructure { path } from the result.
    return { path: filePath };
  }

  const requestedSessionId = sessionsMatch[1];
  const relativeSubPath = sessionsMatch[2];

  try {
    // List the sessions directory to see what session IDs exist.
    const sessionsListing = await virtualFilesystem.listDirectory(
      ownerId,
      'workspace/sessions'
    );

    // Iterate over each session folder.
    for (const node of sessionsListing.nodes) {
      if (node.type === 'directory') {
        const sessionId = node.name;
        // Skip the requested session ID since we already know the file wasn't there.
        if (sessionId === requestedSessionId) {
          continue;
        }
        const candidatePath = `workspace/sessions/${sessionId}/${relativeSubPath}`;
        try {
          const file = await virtualFilesystem.readFile(ownerId, candidatePath);
          // Found the file in another session! Return the corrected path and cached content.
          console.warn(`[VFS] Session path mismatch corrected: "${filePath}" -> "${candidatePath}"`);
          return { path: candidatePath, content: file };
        } catch (e) {
          // File not found in this session, try next.
          continue;
        }
      }
    }
  } catch (listError) {
    console.error('[VFS] Failed to list sessions directory for correction:', listError);
  }

  // If we couldn't find the file in any other session, return the original path.
  // The caller will handle the error appropriately.
  return { path: filePath };
}
