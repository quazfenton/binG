/**
 * POST /api/workspace/[workspaceId]/sessions/reconnect
 *
 * Reconnects an individual disconnected session (shell, agent, preview,
 * editor, log, or execution). Marks the session as active in the workspace
 * session graph and returns the metadata the frontend needs to re-establish
 * the connection (WebSocket URL, agent resume endpoint, preview URL, etc.).
 *
 * Body: { sessionId: string }
 *
 * Auth: Requires valid JWT or session cookie. Rate-limited to prevent abuse.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter';
import { workspaceSessionGraph, type SessionGraphNode } from '@/lib/workspace/workspace-session-graph';
import { formatSessionLabel } from '@/lib/workspace/session-label-utils';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:WorkspaceSessionsReconnect');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    // Authenticate user
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const userId = authResult.userId;

    // Rate limiting: prevent rapid reconnection attempts
    const rateLimitResult = checkUserRateLimit(userId, 'generic');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitResult.headers },
      );
    }

    const { workspaceId } = await params;

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId is required' },
        { status: 400 },
      );
    }

    // Parse request body
    let body: { sessionId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body — JSON required' },
        { status: 400 },
      );
    }

    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'sessionId is required (string)' },
        { status: 400 },
      );
    }

    // Reconnect the session in the workspace graph
    const reconnected = workspaceSessionGraph.reconnectSession(sessionId);

    if (!reconnected) {
      return NextResponse.json(
        { error: 'Session not found or not in disconnected state' },
        { status: 404 },
      );
    }

    // Verify the session belongs to this workspace and user
    if (reconnected.workspaceId !== workspaceId || reconnected.userId !== userId) {
      // Rollback — mark as disconnected again
      workspaceSessionGraph.unregisterSession(sessionId, false);
      return NextResponse.json(
        { error: 'Session does not belong to this workspace or user' },
        { status: 403 },
      );
    }

    // Build reconnection instructions based on session type
    const host = request.headers.get('host') || 'localhost:3000';
    const reconnectionDetails = buildReconnectionDetails(reconnected, workspaceId, host);

    logger.info('Session reconnected', {
      sessionId: sessionId.slice(0, 24),
      type: reconnected.sessionType,
      subtype: reconnected.sessionSubtype,
      workspaceId: workspaceId.slice(0, 16),
    });

    return NextResponse.json({
      success: true,
      data: {
        sessionId: reconnected.id,
        sessionType: reconnected.sessionType,
        sessionSubtype: reconnected.sessionSubtype,
        status: reconnected.status,
        label: formatSessionLabel(reconnected),
        metadata: reconnected.metadata,
        sandboxId: reconnected.sandboxId,
        provider: reconnected.provider,
        reconnection: reconnectionDetails,
      },
    });
  } catch (error: any) {
    logger.error('Failed to reconnect session', { error: error.message });
    return NextResponse.json(
      { error: 'Failed to reconnect session' },
      { status: 500 },
    );
  }
}

// ============================================================================
// Reconnection Details Builder
// ============================================================================

interface ReconnectionDetails {
  /** Human-readable instruction for the frontend */
  instruction: string;
  /** Suggested API endpoint for the frontend to call */
  endpoint?: string;
  /** WebSocket reconnection URL (shell sessions) */
  wsUrl?: string;
  /** Preview URL to redirect to (preview sessions) */
  previewUrl?: string;
  /** Agent session key for resume (agent sessions) */
  sessionKey?: string;
  /** Extra parameters the frontend should pass */
  params?: Record<string, string>;
}

function buildReconnectionDetails(
  node: SessionGraphNode,
  workspaceId: string,
  host: string,
): ReconnectionDetails {
  const wsProtocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws';

  switch (node.sessionType) {
    case 'shell': {
      const shellPath = node.metadata?.sessionId || node.metadata?.id || '';
      return {
        instruction: 'Reconnect to the terminal via WebSocket. Open a new WebSocket connection to the /ws/terminal endpoint.',
        wsUrl: shellPath
          ? `${wsProtocol}://${host}/ws/terminal?sessionId=${encodeURIComponent(shellPath)}&workspaceId=${encodeURIComponent(workspaceId)}`
          : undefined,
        params: { sessionId: shellPath, workspaceId },
      };
    }

    case 'agent': {
      return {
        instruction: 'Resume the AI agent session. Call POST /api/agent/v2/session/resume with the session key.',
        endpoint: '/api/agent/v2/session/resume',
        sessionKey: node.metadata?.sessionKey || node.metadata?.v2SessionId || '',
        params: {
          sessionId: node.metadata?.sessionId || node.id,
          conversationId: node.metadata?.conversationId || '',
        },
      };
    }

    case 'preview': {
      const port = node.metadata?.port;
      const serviceName = node.metadata?.serviceName || node.sessionSubtype;
      return {
        instruction: port
          ? `Re-establish the preview for ${serviceName} on port ${port}. The preview URL will be available once the dev server restarts.`
          : `Re-establish the preview for ${serviceName}. The preview URL will be re-registered.`,
        previewUrl: node.metadata?.previewUrl ?? undefined,
        params: {
          serviceId: node.metadata?.serviceId || '',
          port: port ? String(port) : '',
        },
      };
    }

    case 'editor': {
      return {
        instruction: 'Restore the editor session. File operations can resume immediately.',
        endpoint: '/api/mcp',
        params: {
          userId: node.userId,
          sessionId: node.metadata?.sessionId || '',
        },
      };
    }

    case 'log': {
      return {
        instruction: 'Reconnect to the service log stream. New output will be visible via the workspace services API.',
        endpoint: `/api/workspace/${workspaceId}/services/${node.metadata?.serviceId || ''}/logs`,
        params: {
          serviceId: node.metadata?.serviceId || '',
          serviceName: node.metadata?.serviceName || '',
        },
      };
    }

    case 'execution': {
      return {
        instruction: 'Restore the code execution session. The execution context can be re-established.',
        endpoint: '/api/code/execute',
        params: {
          language: node.sessionSubtype || node.metadata?.language || '',
        },
      };
    }

    default:
      return {
        instruction: 'Reconnect the session.',
      };
  }
}
