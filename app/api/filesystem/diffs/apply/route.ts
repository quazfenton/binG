import { NextRequest, NextResponse } from 'next/server';
import { virtualFilesystem } from '@/lib/virtual-filesystem';
import { resolveScopedPath } from '@/lib/virtual-filesystem/scope-utils';
import { parsePatch, applyPatch } from 'diff';

/**
 * Extract user identity from server-side headers
 * CRITICAL: Never use buildApiHeaders() in server routes - it's client-only
 */
function getUserIdFromRequest(request: NextRequest): string {
  // Try multiple header sources for user identity
  const userId =
    request.headers.get('x-user-id') ||
    request.headers.get('x-auth-user-id') ||
    request.headers.get('x-vercel-user-id') ||
    request.headers.get('x-authenticated-user-id') ||
    'default-user';

  // Validate userId format (prevent injection)
  if (!/^[a-zA-Z0-9_-:]+$/.test(userId)) {
    console.warn('[DiffsApply] Invalid user ID format, using default:', userId);
    return 'default-user';
  }

  return userId;
}

/**
 * Extract session ID from request with validation
 */
function getSessionId(request: NextRequest, bodySessionId?: string): string {
  const sessionId =
    bodySessionId ||
    request.headers.get('x-session-id') ||
    request.headers.get('x-conversation-id') ||
    'default';

  // Validate session ID format
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    console.warn('[DiffsApply] Invalid session ID format, using default:', sessionId);
    return 'default';
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

    // SECURITY: Get real user ID from server-side headers (NOT client-side buildApiHeaders)
    const userId = getUserIdFromRequest(request);
    const sessionId = getSessionId(request, bodySessionId);
    const effectiveScopePath = scopePath || `project/sessions/${sessionId}`;

    // Log for audit trail (without exposing sensitive data)
    console.log('[DiffsApply] Processing diffs for user:', {
      userId: userId === 'default-user' ? 'ANONYMOUS' : userId.substring(0, 8) + '...',
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
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}