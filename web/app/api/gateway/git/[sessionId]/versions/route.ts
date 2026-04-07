import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { resolveFilesystemOwnerWithFallback } from '@/app/api/filesystem/utils';
import { withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';

/**
 * GET /api/gateway/git/[sessionId]/versions
 * Returns version history for a session's VFS shadow commits.
 *
 * Query params:
 * - limit: Maximum number of versions to return (default: 20)
 * - by: 'session' | 'user' — session-scoped or user-scoped (default: session)
 *
 * Scoping: Shadow commits store owner_id (unique per user, e.g. "anon:abc")
 * and session_id (conversation ID, e.g. "001"). This endpoint queries by
 * owner_id to guarantee per-user isolation regardless of the generic folder name.
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
      return NextResponse.json({ error: 'limit must be between 1 and 100' }, { status: 400 });
    }
    const limit = limitValue;
    const byUser = searchParams.get('by') === 'user';

    // Resolve authenticated owner (supports anonymous users with session cookie)
    const authResolution = await resolveFilesystemOwnerWithFallback(request, {
      route: 'versions',
      requestId: Math.random().toString(36).slice(2, 8),
    });
    const ownerId = authResolution.ownerId;

    // Shadow commits store:
    //   owner_id   = full owner string (e.g. "anon:abc:xyz" or "user:123")
    //   session_id = raw conversation/folder ID (e.g. "001")
    //
    // The sessionId from the URL may be:
    //   "001"            → raw conversation ID → use as-is
    //   "session-xxx"    → generated client ID → strip prefix
    //   "owner:001"      → scoped format → extract last part
    let conversationId = sessionId;
    if (conversationId.includes(':')) {
      const parts = conversationId.split(':');
      conversationId = parts[parts.length - 1];
    } else if (conversationId.startsWith('session-')) {
      conversationId = conversationId.replace(/^session-/, '');
    }

    const db = getDatabase();
    const fullOwnerId = typeof ownerId === 'string' ? ownerId : `user:${ownerId}`;

    if (byUser) {
      // User-scoped: return all commits for this owner (cross-session)
      const rows = db.prepare(`
        SELECT id, session_id, message, files_changed, workspace_version, created_at, paths
        FROM shadow_commits
        WHERE owner_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(fullOwnerId, limit) as Array<{
        id: string;
        session_id: string;
        message: string;
        files_changed: number;
        workspace_version: number;
        created_at: string;
        paths: string | null;
      }>;

      const versions = rows.map(row => {
        let paths: string[] = [];
        if (row.paths) {
          try { paths = JSON.parse(row.paths); } catch { paths = []; }
        }
        return {
          version: row.workspace_version || 0,
          commitId: row.id,
          message: row.message,
          filesChanged: row.files_changed || 0,
          createdAt: new Date(row.created_at).getTime(),
          sessionId: row.session_id,
          paths,
        };
      });

      const response = NextResponse.json({ versions, by: 'user' });
      return withAnonSessionCookie(response, authResolution);
    }

    // Session-scoped: commits matching owner_id + session_id
    const rows = db.prepare(`
      SELECT id, session_id, message, files_changed, workspace_version, created_at, paths
      FROM shadow_commits
      WHERE owner_id = ? AND session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(fullOwnerId, conversationId, limit) as Array<{
      id: string;
      session_id: string;
      message: string;
      files_changed: number;
      workspace_version: number;
      created_at: string;
      paths: string | null;
    }>;

    const versions = rows.map(row => {
      let paths: string[] = [];
      if (row.paths) {
        try {
          paths = JSON.parse(row.paths);
        } catch {
          // Malformed JSON — treat as no paths
          paths = [];
        }
      }
      return {
        version: row.workspace_version || 0,
        commitId: row.id,
        message: row.message,
        filesChanged: row.files_changed || 0,
        createdAt: new Date(row.created_at).getTime(),
        paths,
      };
    });

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
