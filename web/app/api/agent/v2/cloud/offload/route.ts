/**
 * Agent V2 Cloud Offload API Route
 * 
 * Spawn cloud agent instances for resource-intensive tasks.
 */

import { NextRequest, NextResponse } from 'next/server';


import { z } from 'zod';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { cloudAgentOffload } from '@bing/shared/agent';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AgentV2:Cloud');

const cloudOffloadSchema = z.object({
  task: z.string().min(1),
  provider: z.enum(['daytona', 'e2b']).default('daytona'),
  resources: z.object({
    cpu: z.number().optional().default(2),
    memory: z.number().optional().default(4),
  }).optional(),
  timeout: z.number().optional().default(1800),
});

/**
 * POST /api/agent/v2/cloud/offload
 * Spawn cloud agent
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    // Parse request
    const body = await request.json();
    const validation = cloudOffloadSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 },
      );
    }

    const { task, provider, resources, timeout } = validation.data;

    logger.info(`Spawning cloud agent via ${provider} for ${userId}`);

    // Spawn agent
    const instance = await cloudAgentOffload.spawnAgent(task, {
      provider,
      image: 'daytonaio/opencode-agent:latest',
      resources: {
        cpu: resources?.cpu ?? 2,
        memory: resources?.memory ?? 4,
      },
      timeout: timeout || 1800,
      taskId: `${userId}-${Date.now()}`,
    });

    return NextResponse.json({
      success: true,
      data: {
        agentId: instance.id,
        provider: instance.provider,
        status: instance.status,
        statusUrl: instance.statusUrl,
        resultUrl: instance.resultUrl,
        estimatedCost: instance.estimatedCost,
        createdAt: instance.createdAt,
      },
    });

  } catch (error: any) {
    logger.error('Failed to spawn cloud agent', error);
    return NextResponse.json(
      { error: error.message || 'Failed to spawn cloud agent' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/agent/v2/cloud/:agentId/status
 * Get cloud agent status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    const instance = cloudAgentOffload.getStatus(agentId);
    
    if (!instance) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        agentId: instance.id,
        provider: instance.provider,
        sandboxId: instance.sandboxId,
        status: instance.status,
        estimatedCost: instance.estimatedCost,
        createdAt: instance.createdAt,
        completedAt: instance.completedAt,
        error: instance.error,
      },
    });

  } catch (error: any) {
    logger.error('Failed to get agent status', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get status' },
      { status: 500 },
    );
  }
}
