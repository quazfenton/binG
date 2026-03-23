/**
 * Agent Events SSE Stream
 *
 * Handles subscription to agent events via Server-Sent Events (SSE):
 * - GET /api/spawn/[id]/events - Subscribe to events for a specific agent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { getAgentServiceManager } from '@/lib/spawn';

const logger = createLogger('API:Agents:Events');

// ============================================================================
// GET /api/spawn/[id]/events - Subscribe to events (SSE)
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const manager = getAgentServiceManager();
    const agent = manager.getAgent(id);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Create SSE stream with proper cleanup
    const encoder = new TextEncoder();
    let eventIterator: AsyncIterableIterator<any> | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          eventIterator = await manager.subscribe(id);

          for await (const event of eventIterator) {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }

          controller.close();
        } catch (error: any) {
          controller.error(error);
        }
      },
      cancel() {
        // Cancel the event iterator to release resources
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
