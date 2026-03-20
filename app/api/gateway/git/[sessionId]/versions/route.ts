import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

/**
 * GET /api/gateway/git/[sessionId]/versions
 * Returns version history for a session's VFS snapshots
 * 
 * Query params:
 * - limit: Maximum number of versions to return (default: 20)
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

    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const db = getDatabase();

    const session = db.prepare(`
      SELECT user_id FROM user_sessions WHERE id = ? AND is_active = TRUE
    `).get(sessionId) as { user_id: number } | undefined;

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const ownerId = session.user_id;

    if (ownerId !== Number(authResult.userId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

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
    `).all(sessionId, limit) as Array<{
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

    return NextResponse.json({ versions });
  } catch (error) {
    console.error('[Git Versions] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch versions', versions: [] },
      { status: 500 }
    );
  }
}