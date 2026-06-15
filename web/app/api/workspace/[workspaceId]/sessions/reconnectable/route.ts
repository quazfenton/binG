/**
 * GET /api/workspace/[workspaceId]/sessions/reconnectable
 *
 * Returns all disconnected sessions for a workspace that can be independently
 * reconnected. Sessions are grouped by type (shell, agent, preview, editor,
 * log, execution) and sorted by most recently disconnected.
 *
 * Each session includes metadata needed for the dashboard UI to offer
 * per-session reconnection buttons.
 *
 * Auth: Requires valid JWT or session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { workspaceSessionGraph } from '@/lib/workspace/workspace-session-graph';
import { formatDuration, formatSessionLabel, getReconnectHint } from '@/lib/workspace/session-label-utils';
import { createLogger } from '@/lib/utils/logger';
import { withUISourceScope } from '@/lib/http/ui-source-header-server';

const logger = createLogger('API:WorkspaceSessionsReconnectable');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return withUISourceScope(request, async () => {
    try {
    // Authenticate user
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const { workspaceId } = await params;

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId is required' },
        { status: 400 },
      );
    }

    const userId = authResult.userId;

    // Query reconnectable sessions from the workspace session graph
    const reconnectable = workspaceSessionGraph.getReconnectableSessions(workspaceId, userId);

    // Build response — one flat list with all fields; frontend groups client-side
    const sessions = reconnectable.map(s => ({
      sessionId: s.node.id,
      sessionType: s.node.sessionType,
      sessionSubtype: s.node.sessionSubtype,
      status: s.node.status,
      disconnectedAt: s.disconnectedAt,
      idleDurationMs: s.idleDuration,
      idleDurationHuman: formatDuration(s.idleDuration),
      label: formatSessionLabel(s.node),
      reconnectHint: getReconnectHint(s.node.sessionType),
      metadata: s.node.metadata,
      sandboxId: s.node.sandboxId,
      provider: s.node.provider,
    }));

    logger.info('Reconnectable sessions queried', {
      workspaceId: workspaceId.slice(0, 16),
      count: sessions.length,
      types: [...new Set(sessions.map(s => s.sessionType))],
    });

    return NextResponse.json({
      success: true,
      data: {
        workspaceId,
        total: sessions.length,
        sessions,
      },
    });
    } catch (error: any) {
      logger.error('Failed to query reconnectable sessions', { error: error.message });
      return NextResponse.json(
        { error: 'Failed to query reconnectable sessions' },
        { status: 500 },
      );
    }
  });
}
