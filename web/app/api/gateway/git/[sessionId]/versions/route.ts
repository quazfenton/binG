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
    //   owner_id   = full owner string (e.g. "anon:timestamp_randomid")
    //   session_id = same full owner string (currently stored identically)
    //
    // The sessionId from the URL is the conversation ID (e.g., "004"),
    // but shadow_commits stores the full owner ID as session_id.
    // Query by owner_id which uniquely identifies the session.
    const db = getDatabase();
    const fullOwnerId = typeof ownerId === 'string' ? ownerId : `user:${ownerId}`;

    if (byUser) {
      // User-scoped: return all commits for this owner (cross-session)
      const rows = db.prepare(`
        SELECT id, session_id, message, workspace_version, created_at, transactions
        FROM shadow_commits
        WHERE owner_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(fullOwnerId, limit) as Array<{
        id: string;
        session_id: string;
        message: string;
        workspace_version: number;
        created_at: string;
        transactions: string | null;
      }>;

      const versions = rows.map(row => {
        let paths: string[] = [];
        let filesChanged = 0;
        if (row.transactions) {
          try {
            const txs = JSON.parse(row.transactions);
            if (Array.isArray(txs)) {
              paths = txs.map((t: any) => t.path).filter(Boolean);
              filesChanged = txs.length;
            }
          } catch { paths = []; }
        }
        return {
          version: row.workspace_version || 0,
          commitId: row.id,
          message: row.message,
          filesChanged,
          createdAt: new Date(row.created_at).getTime(),
          sessionId: row.session_id,
          paths,
        };
      });

      const response = NextResponse.json({ versions, by: 'user' });
      return withAnonSessionCookie(response, authResolution);
    }

    // Session-scoped: query by owner_id since shadow_commits stores
    // the full owner string as session_id (not the conversation ID).
    const rows = db.prepare(`
      SELECT id, session_id, message, workspace_version, created_at, transactions
      FROM shadow_commits
      WHERE owner_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(fullOwnerId, limit) as Array<{
      id: string;
      session_id: string;
      message: string;
      workspace_version: number;
      created_at: string;
      transactions: string | null;
    }>;

    const versions = rows.map(row => {
      let paths: string[] = [];
      let filesChanged = 0;
      if (row.transactions) {
        try {
          const txs = JSON.parse(row.transactions);
          if (Array.isArray(txs)) {
            paths = txs.map((t: any) => t.path).filter(Boolean);
            filesChanged = txs.length;
          }
        } catch { paths = []; }
      }
      return {
        version: row.workspace_version || 0,
        commitId: row.id,
        message: row.message,
        filesChanged,
        createdAt: new Date(row.created_at).getTime(),
        paths,
      };
    });

    const response = NextResponse.json({ versions, by: 'session' });
    return withAnonSessionCookie(response, authResolution);
  } catch (error) {
    console.error('[Git Versions] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch versions', versions: [], details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
