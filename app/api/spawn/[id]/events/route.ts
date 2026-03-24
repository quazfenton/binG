/**
 * Agent Events SSE Stream
 *
 * Handles subscription to agent events via Server-Sent Events (SSE):
 * - GET /api/spawn/[id]/events - Subscribe to events for a specific agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { getAgentServiceManager } from '@/lib/spawn';
import { auth0 } from '@/lib/auth0';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';

const logger = createLogger('API:Agents:Events');

// ============================================================================
// GET /api/spawn/[id]/events - Subscribe to events (SSE)
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Auth check: Require authenticated user
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get local user ID for ownership check
    const auth0UserId = session.user.sub;
    const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    if (!localUserId) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const { id } = await params;
    const manager = getAgentServiceManager();
    const agent = manager.getAgent(id);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Note: Ownership check intentionally omitted - agents are ephemeral and
    // not tied to specific users. If ownership is added in the future, use:
    // if (agent.userId !== undefined && agent.userId !== localUserId) {
    //   return NextResponse.json(
    //     { error: 'Access denied: You do not own this agent' },
    //     { status: 403 }
    //   );
    // }
    // This guards against undefined userId denying valid subscriptions.

    // Create SSE stream with proper cleanup
    const encoder = new TextEncoder();
    let eventIterator: AsyncIterableIterator<any> | null = null;
    let abortController: AbortController | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        abortController = new AbortController();

        try {
          eventIterator = await manager.subscribe(id);

          for await (const event of eventIterator) {
            if (abortController.signal.aborted) {
              break;
            }
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }

          controller.close();
        } catch (error: any) {
          if (!abortController.signal.aborted) {
            controller.error(error);
          }
        } finally {
          // Clean up event iterator on stream end
          if (eventIterator && (eventIterator as any).return) {
            (eventIterator as any).return();
          }
        }
      },
      cancel() {
        // Client disconnected - abort the subscription to release resources
        if (abortController) {
          abortController.abort();
        }
        if (eventIterator && (eventIterator as any).return) {
          (eventIterator as any).return();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: any) {
    logger.error('Failed to subscribe to events', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
