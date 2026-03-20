import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';

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
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const db = getDatabase();

    // Look up session by session_id to get the user_id
    const session = db.prepare(`
      SELECT user_id FROM user_sessions WHERE id = ? AND is_active = TRUE
    `).get(sessionId) as { user_id: number } | undefined;

    if (!session) {
      // Try to find by anonymous session pattern
      const anonSession = db.prepare(`
        SELECT user_id FROM user_sessions 
        WHERE id LIKE ? AND is_active = TRUE
      `).get(`%${sessionId}%`) as { user_id: number } | undefined;
      
      if (!anonSession) {
        return NextResponse.json(
          { error: 'Session not found', versions: [] },
          { status: 404 }
        );
      }
    }

    const userId = session?.user_id;

    // Get version history from vfs_snapshots table
    // The snapshots table should have version information
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

    // Transform to match expected format
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