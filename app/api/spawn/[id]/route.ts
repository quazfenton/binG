/**
 * Individual Agent API Routes (Spawn)
 *
 * Handles routes for specific agent operations:
 * - GET    /api/spawn/[id]      - Get agent details
 * - POST   /api/spawn/[id]/prompt - Send prompt
 * - DELETE /api/spawn/[id]      - Stop agent
 * - GET    /api/spawn/[id]/events - Subscribe to events (SSE)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';
import { getAgentServiceManager, type PromptRequest } from '@/lib/spawn';

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = promptSchema.parse(body);

    const manager = getAgentServiceManager();
    const agent = manager.getAgent(id);

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

    const result = await manager.prompt(id, promptRequest);

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const manager = getAgentServiceManager();
    
    // Check if agent exists before attempting to stop
    const agent = manager.getAgent(id);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }
    
    await manager.stopAgent(id);

    return NextResponse.json({
      success: true,
      message: `Agent ${id} stopped`,
    });
  } catch (error: any) {
    logger.error('Failed to stop agent', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
