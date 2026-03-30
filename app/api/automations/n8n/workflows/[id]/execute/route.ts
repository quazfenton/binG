/**
 * Execute n8n Workflow
 *
 * POST /api/automations/n8n/workflows/:id/execute
 */

import { NextRequest, NextResponse } from 'next/server';
import { getN8nClient } from '@/lib/automations/n8n-client';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:n8n:Execute');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getN8nClient();

    if (!client) {
      return NextResponse.json(
        { error: 'n8n not configured' },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { data } = body;

    const execution = await client.executeWorkflow(id, data);

    logger.info('Workflow executed:', { workflowId: id, executionId: execution.id });

    return NextResponse.json({
      success: true,
      execution,
    });
  } catch (error: any) {
    logger.error('Failed to execute workflow:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to execute workflow' },
      { status: 500 }
    );
  }
}
