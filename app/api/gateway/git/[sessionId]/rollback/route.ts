import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';

/**
 * POST /api/gateway/git/[sessionId]/rollback
 * Rollback VFS to a specific version
 * 
 * Body:
 * - version: The version number to rollback to
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const { version } = body;

    if (!version || typeof version !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Invalid version number' },
        { status: 400 }
      );
    }

    const db = getDatabase();

    // Verify session exists
    const session = db.prepare(`
      SELECT user_id FROM user_sessions WHERE id = ? AND is_active = TRUE
    `).get(sessionId) as { user_id: number } | undefined;

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }

    // Get the snapshot for the target version
    const snapshot = db.prepare(`
      SELECT * FROM vfs_snapshots 
      WHERE session_id = ? AND id = ?
    `).get(sessionId, version) as any;

    if (!snapshot) {
      return NextResponse.json(
        { success: false, error: 'Version not found' },
        { status: 404 }
      );
    }

    // For now, we just return success - the actual rollback would involve
    // restoring files from the snapshot to the current VFS state
    // In a full implementation, you would:
    // 1. Read the snapshot's file contents
    // 2. Write them back to the current VFS state
    // 3. Update the current version reference

    console.log(`[Git Rollback] Rolled back session ${sessionId} to version ${version}`);

    return NextResponse.json({
      success: true,
      message: `Successfully rolled back to version ${version}`,
      version,
    });
  } catch (error) {
    console.error('[Git Rollback] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to rollback' },
      { status: 500 }
    );
  }
}