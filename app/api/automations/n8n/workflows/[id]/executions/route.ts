/**
 * Get Workflow Executions
 *
 * GET /api/automations/n8n/workflows/:id/executions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getN8nClient } from '@/lib/automations/n8n-client';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:n8n:Executions');

export async function GET(
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

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') as any;

    const executions = await client.getExecutions(id, limit, status);

    return NextResponse.json({
      success: true,
      executions,
      count: executions.length,
    });
  } catch (error: any) {
    logger.error('Failed to fetch executions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch executions' },
      { status: 500 }
    );
  }
}
