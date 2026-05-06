/**
 * Execute n8n Workflow
 *
 * POST /api/automations/n8n/workflows/:id/execute
 * - Uses server env vars by default
 * - Accepts X-N8N-URL and X-N8N-API-KEY headers for per-user config
 */

import { NextRequest, NextResponse } from 'next/server';


import { n8nClient } from '@/lib/automations/n8n-client';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:n8n:Execute');

/**
 * Get n8n client from env vars or request headers
 */
function getN8nClientFromRequest(request: NextRequest) {
  const userN8nUrl = request.headers.get('X-N8N-URL');
  const userApiKey = request.headers.get('X-N8N-API-KEY');
  
  if (userN8nUrl) {
    return new n8nClient({
      baseUrl: userN8nUrl,
      apiKey: userApiKey || undefined,
    });
  }
  
  const n8nUrl = process.env.NEXT_PUBLIC_N8N_URL || process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  
  if (!n8nUrl) return null;
  
  return new n8nClient({
    baseUrl: n8nUrl,
    apiKey: apiKey || undefined,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = getN8nClientFromRequest(request);

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
