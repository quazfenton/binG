/**
 * Workflow API
 *
 * GET /api/orchestration/workflows - List workflows
 * POST /api/orchestration/workflows/:id/execute - Execute workflow
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { mastraWorkflowIntegration } from '@bing/shared/agent/mastra-workflow-integration';

const logger = createLogger('API:Orchestration:Workflows');

// GET - List workflows
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    
    const proposals = mastraWorkflowIntegration.listProposals({ status: status as any });
    const workflows = proposals.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      createdAt: p.createdAt,
    }));

    return NextResponse.json({
      success: true,
      workflows,
      count: workflows.length,
    });
  } catch (error: any) {
    logger.error('Failed to get workflows:', error);
    return NextResponse.json(
      { error: 'Failed to get workflows' },
      { status: 500 }
    );
  }
}

// POST - Execute workflow
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { task, ownerId } = body;

    if (!task) {
      return NextResponse.json(
        { error: 'Task is required' },
        { status: 400 }
      );
    }

    const result = await mastraWorkflowIntegration.executeWorkflow('code-agent', {
      task,
      ownerId: ownerId || 'unknown',
    });

    logger.info('Workflow executed:', { workflowId: id, success: result.success });

    return NextResponse.json({
      success: result.success,
      result: result.result,
      workflowId: id,
    });
  } catch (error: any) {
    logger.error('Failed to execute workflow:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute workflow' },
      { status: 500 }
    );
  }
}
