import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { resolveFilesystemOwnerWithFallback } from '@/app/api/filesystem/utils';
import { withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';

/**
 * GET /api/gateway/git/[sessionId]/versions
 * Returns version history for a session's VFS snapshots
 *
 * Query params:
 * - limit: Maximum number of versions to return (default: 20)
 * - by: 'session' | 'user' - Get versions for session or entire user account (default: session)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get('limit');
    const limitValue = rawLimit ? Number.parseInt(rawLimit, 10) : 20;
    if (!Number.isFinite(limitValue) || limitValue < 1 || limitValue > 100) {
      return NextResponse.json({ error: 'limit must be an integer between 1 and 100' }, { status: 400 });
    }
    const limit = limitValue;

    // New: Support getting commits by user account
    const byUser = searchParams.get('by') === 'user';

    // Resolve auth with fallback (allows anonymous users)
    const authResolution = await resolveFilesystemOwnerWithFallback(request, {
      route: 'versions',
      requestId: Math.random().toString(36).slice(2, 8),
    });
    const ownerId = authResolution.ownerId;

    const db = getDatabase();

    // Session IDs are scoped to owner
    const scopedSessionId = `${ownerId}:${sessionId}`;

    const session = db.prepare(`
      SELECT user_id FROM user_sessions WHERE session_id = ? AND is_active = TRUE
    `).get(scopedSessionId) as { user_id: number } | undefined;

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const ownerIdFromSession = session.user_id;

    // Verify ownership
    if (ownerIdFromSession !== Number(ownerId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // If by=user, return commits from shadow_commits table for the entire user account
    if (byUser) {
      const shadowCommitManager = new ShadowCommitManager();
      const userOwnerId = `user:${ownerId}`;
      const history = await shadowCommitManager.getCommitHistoryByUser(userOwnerId, limit);

      const versions = history.map(h => ({
        version: h.workspaceVersion || 0,
        commitId: h.commitId,
        message: h.message,
        filesChanged: h.filesChanged || 0,
        createdAt: new Date(h.createdAt).getTime(),
        sessionId: h.sessionId,
      }));

      const response = NextResponse.json({
        versions,
        by: 'user',
        ownerId: userOwnerId,
      });
      return withAnonSessionCookie(response, authResolution);
    }

    // Default: Return VFS snapshots for this session
    const snapshots = db.prepare(`
      SELECT
        id as version,
        id as commitId,
        created_at as createdAt,
        file_count as filesChanged,
        'Auto-saved snapshot' as message
      FROM vfs_snapshots
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(scopedSessionId, limit) as Array<{
      version: number;
      commitId: number;
      createdAt: string;
      filesChanged: number;
      message: string;
    }>;

    const versions = snapshots.map(s => ({
      version: s.version,
      commitId: `commit_${s.commitId}`,
      message: s.message,
      filesChanged: s.filesChanged || 0,
      createdAt: new Date(s.createdAt).getTime(),
    }));

    const response = NextResponse.json({ versions, by: 'session' });
    return withAnonSessionCookie(response, authResolution);
  } catch (error) {
    console.error('[Git Versions] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch versions', versions: [] },
      { status: 500 }
    );
  }
}