/**
 * Agent V2 Cloud Agent API Routes
 * 
 * Manage individual cloud agent instances (status, result, cancel)
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { z } from 'zod';
import { cloudAgentOffload } from '@bing/shared/agent';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AgentV2:Cloud:Agent');

const getResultSchema = z.object({
  timeout: z.number().optional(),
});

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

/**
 * POST /api/agent/v2/cloud/:agentId/result
 * Get cloud agent result (blocks until complete)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    const body = await request.json();
    const validation = getResultSchema.safeParse(body);
    const timeout = validation.success ? validation.data.timeout : undefined;

    const result = await cloudAgentOffload.getResult(agentId, timeout);

    return NextResponse.json({
      success: result.success,
      data: result,
    });

  } catch (error: any) {
    logger.error('Failed to get agent result', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get result' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/agent/v2/cloud/:agentId
 * Cancel cloud agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    await cloudAgentOffload.cancel(agentId);

    return NextResponse.json({
      success: true,
      message: 'Agent cancelled',
    });

  } catch (error: any) {
    logger.error('Failed to cancel agent', error);
    return NextResponse.json(
      { error: error.message || 'Failed to cancel agent' },
      { status: 500 },
    );
  }
}
