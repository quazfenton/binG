/**
 * Workflow API
 *
 * GET /api/orchestration/workflows - List workflows
 * POST /api/orchestration/workflows/:id/execute - Execute workflow
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkflows, executeWorkflow } from '@/lib/orchestration/agent-orchestrator';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Orchestration:Workflows');

// GET - List workflows
export async function GET() {
  try {
    const workflows = await getWorkflows();
    
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
    const { params: workflowParams } = body;

    const result = await executeWorkflow(id, workflowParams);

    logger.info('Workflow executed:', { workflowId: id, executionId: result.executionId });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    logger.error('Failed to execute workflow:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute workflow' },
      { status: 500 }
    );
  }
}
