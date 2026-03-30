/**
 * n8n Workflows API
 *
 * GET /api/automations/n8n/workflows - List workflows
 * POST /api/automations/n8n/workflows/:id/execute - Execute workflow
 * GET /api/automations/n8n/workflows/:id/executions - Get executions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getN8nClient } from '@/lib/automations/n8n-client';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:n8n:Workflows');

// GET - List all workflows
export async function GET() {
  try {
    const client = getN8nClient();

    if (!client) {
      return NextResponse.json(
        { error: 'n8n not configured. Set NEXT_PUBLIC_N8N_URL and N8N_API_KEY' },
        { status: 503 }
      );
    }

    const workflows = await client.getWorkflows();

    return NextResponse.json({
      success: true,
      workflows,
      count: workflows.length,
    });
  } catch (error: any) {
    logger.error('Failed to fetch workflows:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workflows' },
      { status: 500 }
    );
  }
}
