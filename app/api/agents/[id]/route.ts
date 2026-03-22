/**
 * Individual Agent API Routes
 * 
 * Handles routes for specific agent operations:
 * - GET    /api/agents/[id]      - Get agent details
 * - POST   /api/agents/[id]/prompt - Send prompt
 * - DELETE /api/agents/[id]      - Stop agent
 * - GET    /api/agents/[id]/events - Subscribe to events (SSE)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';
import { getAgentServiceManager, type PromptRequest } from '@/lib/agents';

const logger = createLogger('API:Agents:Dynamic');

// ============================================================================
// Schemas
// ============================================================================

const promptSchema = z.object({
  message: z.string().min(1),
  model: z.string().optional(),
  system: z.string().optional(),
  context: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
  timeout: z.number().optional(),
});

// ============================================================================
// GET /api/agents/[id] - Get agent details
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const manager = getAgentServiceManager();
    const agent = manager.getAgent(params.id);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { agent },
    });
  } catch (error: any) {
    logger.error('Failed to get agent', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/agents/[id]/prompt - Send prompt to agent
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const parsed = promptSchema.parse(body);

    const manager = getAgentServiceManager();
    const agent = manager.getAgent(params.id);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    const promptRequest: PromptRequest = {
      message: parsed.message,
      model: parsed.model,
      system: parsed.system,
      context: parsed.context,
      stream: parsed.stream,
      timeout: parsed.timeout,
    };

    const result = await manager.prompt(params.id, promptRequest);

    return NextResponse.json({
      success: true,
      data: { result },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors },
        { status: 400 }
      );
    }

    logger.error('Failed to send prompt', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/agents/[id] - Stop agent
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const manager = getAgentServiceManager();
    await manager.stopAgent(params.id);

    return NextResponse.json({
      success: true,
      message: `Agent ${params.id} stopped`,
    });
  } catch (error: any) {
    logger.error('Failed to stop agent', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/agents/[id]/events - Subscribe to events (SSE)
// ============================================================================

export async function GETEvents(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const manager = getAgentServiceManager();
    const agent = manager.getAgent(params.id);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    let streamCancelled = false;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const events = await manager.subscribe(params.id);

          for await (const event of events) {
            if (streamCancelled) {
              break;
            }

            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }

          controller.close();
        } catch (error: any) {
          controller.error(error);
        }
      },
      cancel() {
        streamCancelled = true;
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
