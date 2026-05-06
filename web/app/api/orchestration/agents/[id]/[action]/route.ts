/**
 * Agent Control API
 *
 * POST /api/orchestration/agents/:id/start
 * POST /api/orchestration/agents/:id/stop
 * POST /api/orchestration/agents/:id/pause
 * POST /api/orchestration/agents/:id/resume
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { getAgentKernel } from '@bing/shared/agent/agent-kernel';

const logger = createLogger('API:Orchestration:Control');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  try {
    const { id, action } = await params;
    const body = await request.json().catch(() => ({}));
    const { reason } = body;

    const kernel = getAgentKernel();
    let success: boolean;

    switch (action) {
      case 'stop':
      case 'terminate':
        success = await kernel.terminateAgent(id, reason || 'Manual stop');
        logger.info('Agent stopped:', { agentId: id, reason });
        break;

      case 'pause':
      case 'suspend':
        success = await kernel.suspendAgent(id, reason || 'Manual pause');
        logger.info('Agent paused:', { agentId: id, reason });
        break;

      case 'resume':
        success = await kernel.resumeAgent(id);
        logger.info('Agent resumed:', { agentId: id });
        break;

      case 'checkpoint':
        const checkpointId = await kernel.checkpointAgent(id);
        logger.info('Agent checkpointed:', { agentId: id, checkpointId });
        return NextResponse.json({
          success: true,
          action,
          agentId: id,
          checkpointId,
        });

      case 'status':
        const agent = kernel.getAgentStatus(id);
        if (!agent) {
          return NextResponse.json(
            { error: 'Agent not found' },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          agent,
        });

      case 'work':
        // Submit work to agent queue
        const { payload, priority = 'normal' } = body;
        if (!payload) {
          return NextResponse.json(
            { error: 'Payload is required for work submission' },
            { status: 400 }
          );
        }
        const workId = await kernel.submitWork(id, payload, priority as any);
        logger.info('Work submitted to agent:', { agentId: id, workId });
        return NextResponse.json({
          success: true,
          action,
          agentId: id,
          workId,
        });

      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}` },
          { status: 400 }
        );
    }

    if (!success) {
      return NextResponse.json(
        { error: `Failed to ${action} agent` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      action,
      agentId: id,
    });
  } catch (error: any) {
    logger.error('Agent control failed:', error);
    return NextResponse.json(
      { error: error.message || 'Agent control failed' },
      { status: 500 }
    );
  }
}
