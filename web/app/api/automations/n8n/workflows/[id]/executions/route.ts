/**
 * Get Workflow Executions
 *
 * GET /api/automations/n8n/workflows/:id/executions
 * - Uses server env vars by default
 * - Accepts X-N8N-URL and X-N8N-API-KEY headers for per-user config
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { n8nClient } from '@/lib/automations/n8n-client';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:n8n:Executions');

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

export async function GET(
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
      { error: error.message || 'Failed to fetch executions' },
      { status: 500 }
    );
  }
}
