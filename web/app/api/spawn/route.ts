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

export const runtime = 'edge';

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
  type: z.enum(['claude-code', 'amp', 'opencode', 'codex']),
  workspaceDir: z.string().min(1, 'Workspace directory is required'),
  apiKey: z.string().optional(),
  port: z.number()
    .min(1, 'Port must be positive')
    .max(65535, 'Port must be <= 65535')
    .optional(),
  agentId: z.string().optional(),
  /**
   * Remote address of an already-running agent server (e.g. "https://codex.example.com:8080").
   * When provided, the agent skips local binary spawn and containerized fallback,
   * and connects directly to the remote endpoint. Supports web-hosted / cloud deployments.
   */
  remoteAddress: z.string().url('Remote address must be a valid URL').optional(),
  env: z.record(z.string()).optional(),
  resources: z.object({
    cpu: z.number()
      .min(0.1, 'CPU must be at least 0.1')
      .max(128, 'CPU must be <= 128')
      .optional(),
    memory: z.string().optional(),
  }).optional(),
  poolConfig: z.object({
    minSize: z.number()
      .min(0, 'minSize cannot be negative')
      .max(100, 'minSize must be <= 100')
      .optional(),
    maxSize: z.number()
      .min(1, 'maxSize must be at least 1')
      .max(100, 'maxSize must be <= 100')
      .optional(),
    idleTimeout: z.number()
      .min(1000, 'idleTimeout must be at least 1000ms')
      .max(3600000, 'idleTimeout must be <= 1 hour')
      .optional(),
  })
  .refine(
    (data) => !data.minSize || !data.maxSize || data.minSize <= data.maxSize,
    {
      message: 'minSize must be <= maxSize',
      path: ['poolConfig'],
    }
  )
  .optional(),
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
      const { getAllPoolStats } = await import('@/lib/spawn');
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
      try {
        const pool = getAgentPool(parsed.type, {
          agentConfig: {
            workspaceDir: parsed.workspaceDir,
            apiKey: parsed.apiKey,
            port: parsed.port,
            remoteAddress: parsed.remoteAddress,
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
      } catch (poolError: any) {
        logger.error('Failed to create agent pool', { error: poolError.message });
        return NextResponse.json(
          { 
            error: 'Failed to create agent pool', 
            details: poolError.message,
          },
          { status: 500 }
        );
      }
    }

    // Start single agent
    const agent = await manager.startAgent({
      type: parsed.type as AgentType,
      workspaceDir: parsed.workspaceDir,
      apiKey: parsed.apiKey,
      port: parsed.port,
      agentId: parsed.agentId,
      remoteAddress: parsed.remoteAddress,
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

async function GETAgent(
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

async function POSTPrompt(
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
