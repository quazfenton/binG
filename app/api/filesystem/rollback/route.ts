import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { sessionIdSchema, commitIdSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

/**
 * POST /api/filesystem/rollback
 * Body: { sessionId: string, commitId: string }
 *
 * Rolls back the VFS to the state captured in the specified commit.
 * Restores file contents from the commit snapshot into the live VFS.
 */

const rollbackRequestSchema = z.object({
  sessionId: sessionIdSchema,
  commitId: commitIdSchema,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Validate request body with Zod
    const parseResult = rollbackRequestSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return NextResponse.json(
        { 
          success: false, 
          error: firstError.message,
          details: parseResult.error.flatten(),
        },
        { status: 400 },
      );
    }
    
    const { sessionId, commitId } = parseResult.data;

    // Resolve auth upfront for cookie wrapping
    const authResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'rollback',
      requestId: Math.random().toString(36).slice(2, 8),
    });
    const ownerId = authResolution.ownerId;
    const scopedSessionId = `${ownerId}:${sessionId}`;

    const commitManager = new ShadowCommitManager();
    const commit = await commitManager.getCommit(scopedSessionId, commitId);

    if (!commit) {
      const errorResponse = NextResponse.json(
        { success: false, error: 'Commit not found' },
        { status: 404 },
      );
      return withAnonSessionCookie(errorResponse, authResolution);
    }

    // Restore files from the commit into the live VFS
    let restoredCount = 0;
    const restoredPaths: string[] = [];

    if (commit.transactions && commit.transactions.length > 0) {
      for (const txn of commit.transactions) {
        try {
          if (txn.type === 'DELETE' && txn.originalContent !== undefined) {
            // Restore deleted file
            await virtualFilesystem.writeFile(ownerId, txn.path, txn.originalContent);
            restoredPaths.push(txn.path);
            restoredCount++;
          } else if ((txn.type === 'UPDATE' || txn.type === 'CREATE') && txn.newContent !== undefined) {
            // Restore file to the state it was in at this commit
            await virtualFilesystem.writeFile(ownerId, txn.path, txn.newContent);
            restoredPaths.push(txn.path);
            restoredCount++;
          }
        } catch (error) {
          console.error(`[VFS Rollback] Failed to restore ${txn.path}:`, error);
        }
      }
    }

    // Create a rollback commit to track this action
    const rollbackTransactions = restoredPaths.map(p => ({
      path: p,
      type: 'UPDATE' as const,
      timestamp: Date.now(),
    }));

    const rollbackVfs: Record<string, string> = {};
    for (const p of restoredPaths) {
      try {
        const file = await virtualFilesystem.readFile(ownerId, p);
        rollbackVfs[p] = file.content;
      } catch { /* skip */ }
    }

    await commitManager.commit(rollbackVfs, rollbackTransactions, {
      sessionId: scopedSessionId,
      message: `Rollback to commit ${commitId}`,
      author: ownerId,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        restoredFiles: restoredCount,
        restoredPaths,
        rollbackCommitId: commitId,
      },
    });
    return withAnonSessionCookie(response, authResolution);
  } catch (error: unknown) {
    console.error('[VFS Rollback] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to rollback';
    const errorResponse = NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
    return withAnonSessionCookie(errorResponse, {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}
