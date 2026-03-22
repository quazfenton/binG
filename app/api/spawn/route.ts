/**
 * AI Agents API (Spawn)
 *
 * RESTful API for managing containerized AI coding agents.
 *
 * Endpoints:
 * - POST   /api/spawn          - Create/start agent
 * - GET    /api/spawn          - List all agents
 * - GET    /api/spawn/:id      - Get agent details
 * - POST   /api/spawn/:id/prompt - Send prompt to agent
 * - DELETE /api/spawn/:id      - Stop/destroy agent
 * - GET    /api/spawn/pool/stats - Get pool statistics
 *
 * @see lib/spawn/agent-service-manager.ts
 * @see lib/spawn/agent-pool.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';
import {
  getAgentServiceManager,
  getAgentPool,
  type AgentType,
  type PromptRequest,
} from '@/lib/spawn';

const logger = createLogger('API:Agents');

// ============================================================================
// Request Schemas
// ============================================================================

const startAgentSchema = z.object({
  type: z.enum(['claude-code', 'amp', 'opencode']),
  workspaceDir: z.string().min(1),
  apiKey: z.string().optional(),
  port: z.number().optional(),
  agentId: z.string().optional(),
  env: z.record(z.string()).optional(),
  resources: z.object({
    cpu: z.number().optional(),
    memory: z.string().optional(),
  }).optional(),
  poolConfig: z.object({
    minSize: z.number().optional(),
    maxSize: z.number().optional(),
    idleTimeout: z.number().optional(),
  }).optional(),
});

const promptSchema = z.object({
  message: z.string().min(1),
  model: z.string().optional(),
  system: z.string().optional(),
  context: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
  timeout: z.number().optional(),
});

// ============================================================================
// GET /api/agents - List all agents
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');

    if (action === 'pool-stats') {
      const { getAllPoolStats } = await import('@/lib/agents');
      const stats = getAllPoolStats();
      
      return NextResponse.json({
        success: true,
        data: { poolStats: stats },
      });
    }

    const manager = getAgentServiceManager();
    const agents = manager.listAgents();

    return NextResponse.json({
      success: true,
      data: { agents },
    });
  } catch (error: any) {
    logger.error('Failed to list agents', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/agents - Create/start agent
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = startAgentSchema.parse(body);

    const manager = getAgentServiceManager();

    // Check if pool config provided (use pool instead of single agent)
    if (parsed.poolConfig) {
      const pool = getAgentPool(parsed.type, {
        agentConfig: {
          workspaceDir: parsed.workspaceDir,
          apiKey: parsed.apiKey,
          port: parsed.port,
          env: parsed.env,
        },
        ...parsed.poolConfig,
      });

      const stats = pool.getStats();

      return NextResponse.json({
        success: true,
        data: {
          pool: true,
          type: parsed.type,
          stats,
          message: `Agent pool created with ${stats.total} pre-warmed agents`,
        },
      });
    }

    // Start single agent
    const agent = await manager.startAgent({
      type: parsed.type as AgentType,
      workspaceDir: parsed.workspaceDir,
      apiKey: parsed.apiKey,
      port: parsed.port,
      agentId: parsed.agentId,
      env: parsed.env,
      resources: parsed.resources,
    });

    return NextResponse.json({
      success: true,
      data: { agent },
    }, { status: 201 });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors },
        { status: 400 }
      );
    }

    logger.error('Failed to start agent', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET /api/agents/:id - Get agent details
// ============================================================================

export async function GETAgent(
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
// POST /api/agents/:id/prompt - Send prompt to agent
// ============================================================================

export async function POSTPrompt(
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
// DELETE /api/agents/:id - Stop/destroy agent
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const manager = getAgentServiceManager();
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

// ============================================================================
// Route handler
// ============================================================================

// Note: GET, POST, and DELETE are already exported above as route handlers
// No additional exports needed
