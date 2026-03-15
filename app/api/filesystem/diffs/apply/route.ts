import { NextRequest, NextResponse } from 'next/server';
import { virtualFilesystem } from '@/lib/virtual-filesystem';
import { buildApiHeaders } from '@/lib/utils';
import { parsePatch, applyPatch } from 'diff';
import { resolveScopedPath } from '@/lib/virtual-filesystem/scope-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { diffs, scopePath, sessionId } = body;

    if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No diffs provided' },
        { status: 400 }
      );
    }

    // Get user ID from headers
    const headers = buildApiHeaders();
    const userId = headers['x-user-id'] || 'default-user';
    const effectiveScopePath = scopePath || `project/sessions/${sessionId || 'default'}`;

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