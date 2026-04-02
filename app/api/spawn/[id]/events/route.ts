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
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        abortController = new AbortController();

        try {
          // Subscribe to agent events - get both iterator and unsubscribe function
          const subscription = await manager.subscribe(id);
          
          // Handle both subscription object { iterator, unsubscribe } and plain iterator
          if (subscription && typeof subscription === 'object') {
            if ('iterator' in subscription && 'unsubscribe' in subscription) {
              eventIterator = (subscription as any).iterator as AsyncIterableIterator<any>;
              unsubscribe = (subscription as any).unsubscribe as () => void;
            } else if (Symbol.asyncIterator in subscription) {
              eventIterator = subscription as AsyncIterableIterator<any>;
            }
          } else if (subscription && Symbol.asyncIterator in subscription) {
            eventIterator = subscription as AsyncIterableIterator<any>;
          }

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
            logger.error('SSE stream error', { agentId: id, error: error.message });
            controller.error(error);
          }
        } finally {
          // Clean up event iterator on stream end
          if (eventIterator && (eventIterator as any).return) {
            (eventIterator as any).return();
          }
          // Call explicit unsubscribe if provided
          if (unsubscribe) {
            unsubscribe();
          }
        }
      },
      cancel() {
        // Client disconnected - abort the subscription to release resources
        logger.debug('SSE client disconnected', { agentId: id });
        if (abortController) {
          abortController.abort();
        }
        if (eventIterator && (eventIterator as any).return) {
          (eventIterator as any).return();
        }
        // Call explicit unsubscribe if provided
        if (unsubscribe) {
          unsubscribe();
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
    logger.error('Failed to subscribe to events', { 
      agentId: (await params).id,
      error: error.message,
      stack: error.stack 
    });
    
    // Return sanitized error to client
    return NextResponse.json(
      { 
        error: 'Failed to subscribe to events',
        // Only include details in development
        ...(process.env.NODE_ENV === 'development' && {
          details: error.message,
        }),
      },
      { status: 500 }
    );
  }
}
