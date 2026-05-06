/**
 * Agent Orchestration API
 *
 * GET /api/orchestration/agents - List all agents
 * GET /api/orchestration/agents/:id - Get agent details
 * POST /api/orchestration/agents - Create and optionally start agent with streaming
 * POST /api/orchestration/agents/:id/start - Start agent
 * POST /api/orchestration/agents/:id/stop - Stop agent
 * POST /api/orchestration/agents/:id/pause - Pause agent
 * POST /api/orchestration/agents/:id/resume - Resume agent
 * GET /api/orchestration/logs - Get agent logs
 * GET /api/orchestration/workflows - List workflows
 * POST /api/orchestration/workflows/:id/execute - Execute workflow
 * GET /api/orchestration/stats - Get statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { generateSecureId } from '@/lib/utils';
import { createLogger } from '@/lib/utils/logger';
import { getAgentKernel, type AgentConfig, type AgentType, type AgentPriority } from '@bing/shared/agent/agent-kernel';

const logger = createLogger('API:Orchestration');

// GET - List all agents
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || undefined;
    const status = searchParams.get('status') as any;
    const priority = searchParams.get('priority') as AgentPriority | undefined;
    const type = searchParams.get('type') as AgentType | undefined;

    const kernel = getAgentKernel();
    
    const agents = kernel.listAgents({
      userId,
      status,
      priority,
      type,
    });

    return NextResponse.json({
      success: true,
      agents,
      count: agents.length,
    });
  } catch (error: any) {
    logger.error('Failed to get agents:', error);
    return NextResponse.json(
      { error: 'Failed to get agents' },
      { status: 500 }
    );
  }
}

// POST - Create and optionally run agent with streaming
export async function POST(request: NextRequest) {
  // SECURITY: Require authentication
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
  if (!authResult.success) {
    return NextResponse.json(
      { error: authResult.error || 'Authentication required' },
      { status: 401 }
    );
  }

  const userId = authResult.userId;
  const requestId = generateSecureId('orch');

  try {
    const body = await request.json();
    const {
      goal,
      type = 'ephemeral' as AgentType,
      priority = 'normal' as AgentPriority,
      name,
      resources,
      schedule,
      maxIterations,
      tools,
      context,
      metadata,
    } = body;

    if (!goal) {
      return NextResponse.json(
        { error: 'Goal is required' },
        { status: 400 }
      );
    }

    logger.info('[Orchestration] Creating agent:', { requestId, type, priority });

    const kernel = getAgentKernel();
    
    // Ensure kernel is running
    if (!kernel.isRunning()) {
      kernel.start();
    }

    const agentConfig: AgentConfig = {
      id: requestId,
      type,
      name,
      userId,
      goal,
      priority,
      resources,
      schedule,
      maxIterations,
      tools,
      context,
      metadata,
    };

    const agentId = await kernel.spawnAgent(agentConfig);
    const agent = kernel.getAgentStatus(agentId);

    return NextResponse.json({
      success: true,
      agentId,
      agent,
      message: 'Agent created and spawned',
    });
  } catch (error: any) {
    logger.error('Failed to create agent:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create agent' },
      { status: 500 }
    );
  }
}
