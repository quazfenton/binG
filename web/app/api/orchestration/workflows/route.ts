/**
 * Workflow API
 *
 * GET /api/orchestration/workflows - List workflows
 * POST /api/orchestration/workflows/:id/execute - Execute workflow
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Orchestration:Workflows');

// GET - List workflows
export async function GET() {
  try {
    // TODO: Re-implement when agent orchestrator is available
    /*
    const workflows = await getWorkflows();

    return NextResponse.json({
      success: true,
      workflows,
      count: workflows.length,
    });
    */

    return NextResponse.json({ error: 'This endpoint is not implemented' }, { status: 501 });
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

    // TODO: Re-implement when agent orchestrator is available
    /*
    const result = await executeWorkflow(id) as any;

    logger.info('Workflow executed:', { workflowId: id, executionId: result.executionId });

    return NextResponse.json({
      success: true,
      ...result,
    });
    */

    return NextResponse.json({ error: 'This endpoint is not implemented' }, { status: 501 });
  } catch (error: any) {
    logger.error('Failed to execute workflow:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute workflow' },
      { status: 500 }
    );
  }
}
