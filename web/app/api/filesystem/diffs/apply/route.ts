import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';
import { resolveScopedPath, normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { parsePatch, applyPatch } from 'diff';
import { verifyAuth } from '@/lib/auth/jwt';

/**
 * Custom error class for authentication/validation failures
 * Allows proper HTTP status code handling (401/400 instead of 500)
 */
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Extract and verify user ID from JWT token
 * SECURITY: Never trust client-provided headers - always verify with JWT
 */
async function getUserIdFromRequest(request: NextRequest): Promise<string> {
  const authResult = await verifyAuth(request);
  
  if (!authResult.success || !authResult.userId) {
    throw new ApiError(401, authResult.error || 'Authentication failed', 'AUTH_FAILED');
  }
  
  return authResult.userId;
}

/**
 * Extract session ID from request with validation
 * SECURITY: Reject requests with invalid session IDs to prevent unauthorized access
 */
function getSessionId(request: NextRequest, bodySessionId?: string): string {
  const sessionId =
    bodySessionId ||
    request.headers.get('x-session-id') ||
    request.headers.get('x-conversation-id');

  // SECURITY: Require valid session ID
  if (!sessionId) {
    throw new ApiError(400, 'Session ID required', 'MISSING_SESSION_ID');
  }

  // Validate session ID format - allow colons to match IDs produced by chat route
  if (!/^[a-zA-Z0-9:_-]+$/.test(sessionId)) {
    console.warn('[DiffsApply] Invalid session ID format:', sessionId);
    throw new ApiError(400, 'Invalid session ID format', 'INVALID_SESSION_ID_FORMAT');
  }

  return sessionId;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { diffs, scopePath, sessionId: bodySessionId } = body;

    if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No diffs provided' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user identity with JWT (never trust client headers)
    const userId = await getUserIdFromRequest(request);
    const sessionId = getSessionId(request, bodySessionId);
    // CRITICAL FIX: Normalize sessionId to prevent composite IDs in paths
    const simpleSessionId = normalizeSessionId(sessionId) || sessionId; // Use original if normalize returns empty
    const effectiveScopePath = scopePath || `project/sessions/${simpleSessionId}`;

    // Log for audit trail (without exposing sensitive data)
    console.log('[DiffsApply] Processing diffs for authenticated user:', {
      userId: userId.substring(0, 8) + '...',
      sessionId: sessionId.substring(0, 8) + '...',
      diffCount: diffs.length,
      scopePath: effectiveScopePath.substring(0, 50) + '...',
    });

    const results: Array<{
      path: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const diffEntry of diffs) {
      const { path, diff, changeType } = diffEntry;

      if (!path || !diff) {
        results.push({
          path: path || 'unknown',
          success: false,
          error: 'Missing path or diff content',
        });
        continue;
      }

      const resolvedPath = resolveScopedPath(path, effectiveScopePath);

      try {
        if (changeType === 'delete') {
          // Delete the file
          await virtualFilesystem.deletePath(userId, resolvedPath);

          results.push({
            path: resolvedPath,
            success: true,
          });
        } else {
          // For create/update, read current content and apply patch
          let currentContent = '';

          try {
            const file = await virtualFilesystem.readFile(userId, resolvedPath);
            if (file?.content) {
              currentContent = file.content;
            }
          } catch {
            // File doesn't exist yet - that's fine for create operations
          }

          // Parse and apply the diff
          const parsed = parsePatch(diff);
          if (!parsed.length) {
            results.push({
              path: resolvedPath,
              success: false,
              error: 'Invalid diff format',
            });
            continue;
          }

          const patched = applyPatch(currentContent, parsed[0]);
          if (patched === false) {
            results.push({
              path: resolvedPath,
              success: false,
              error: 'Failed to apply diff - may have conflicting changes',
            });
            continue;
          }

          // Write the patched content
          await virtualFilesystem.writeFile(userId, resolvedPath, patched);

          results.push({
            path: resolvedPath,
            success: true,
          });
        }
      } catch (applyError: any) {
        results.push({
          path: resolvedPath,
          success: false,
          error: applyError.message || 'Failed to apply diff',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    return NextResponse.json({
      success: failCount === 0,
      applied: successCount,
      failed: failCount,
      results,
    });
  } catch (error: any) {
    console.error('[DiffsApply] Error:', error);
    
    // Handle ApiError with proper status code
    if (error instanceof ApiError) {
      return NextResponse.json(
        { 
          success: false, 
          error: error.message,
          code: error.code,
        },
        { status: error.status }
      );
    }
    
    // Generic error handler for unexpected errors (500)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
