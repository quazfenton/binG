import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:VFS:Snapshot:Restore');

export const runtime = 'nodejs';

/**
 * POST /api/filesystem/snapshot/restore
 * 
 * Restores a sandbox snapshot and syncs files back to VFS.
 * This route is called by client components to avoid bundling server-only modules.
 */
export async function POST(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8);

  try {
    // Require authentication
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { sessionId, scopePath = 'project', syncToVFS = true } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      );
    }

    // SECURITY: Verify session ownership - resolve session from server-side store
    // and ensure it belongs to the authenticated user (IDOR prevention)
    const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
    const session = sandboxBridge.getSession(sessionId);

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // Verify the authenticated user owns this session
    if (session.userId !== authResult.userId) {
      logger.warn('Snapshot restore IDOR attempt', {
        requestingUser: authResult.userId,
        sessionOwner: session.userId,
        sessionId,
      });
      return NextResponse.json(
        { error: 'You do not have access to this session' },
        { status: 403 }
      );
    }

    logger.info(`[${requestId}] Restoring snapshot`, {
      sessionId,
      scopePath,
      syncToVFS,
      userId: authResult.userId,
    });

    // Dynamic import - server-only module
    const { vfsSyncBackService } = await import('@/lib/virtual-filesystem/sync/vfs-sync-back');

    // Sync sandbox to VFS (session ownership already verified above)
    const result = await vfsSyncBackService.syncSandboxToVFS(sessionId, {
      vfsScopePath: scopePath,
      syncMode: syncToVFS ? 'incremental' : 'changed-only',
    });

    logger.info(`[${requestId}] Snapshot restored`, {
      filesSynced: result.filesSynced,
      bytesSynced: result.bytesSynced,
      duration: result.duration,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to restore snapshot';
    logger.error(`[${requestId}] Failed to restore snapshot`, error);

    return NextResponse.json(
      { success: false, error: message },
      { status: error instanceof Error && message.includes('not found') ? 404 : 500 }
    );
  }
}
