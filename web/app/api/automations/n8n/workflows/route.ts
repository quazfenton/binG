/**
 * n8n Workflows API
 *
 * GET /api/automations/n8n/workflows - List workflows
 * - Uses server env vars (NEXT_PUBLIC_N8N_URL, N8N_API_KEY) by default
 * - Accepts X-N8N-URL and X-N8N-API-KEY headers for per-user config
 *
 * POST /api/automations/n8n/workflows/:id/execute - Execute workflow
 * GET /api/automations/n8n/workflows/:id/executions - Get executions
 */

import { NextRequest, NextResponse } from 'next/server';
import { n8nClient } from '@/lib/automations/n8n-client';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:n8n:Workflows');

/**
 * Get n8n client from env vars or request headers
 * Priority: Headers > Env vars
 */
function getN8nClientFromRequest(request: NextRequest) {
  // Try headers first (per-user config)
  const userN8nUrl = request.headers.get('X-N8N-URL');
  const userApiKey = request.headers.get('X-N8N-API-KEY');
  
  if (userN8nUrl) {
    return new n8nClient({
      baseUrl: userN8nUrl,
      apiKey: userApiKey || undefined,
    });
  }
  
  // Fall back to env vars (server config)
  const n8nUrl = process.env.NEXT_PUBLIC_N8N_URL || process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  
  if (!n8nUrl) {
    return null;
  }
  
  return new n8nClient({
    baseUrl: n8nUrl,
    apiKey: apiKey || undefined,
  });
}

// GET - List all workflows
export async function GET(request: NextRequest) {
  try {
    const client = getN8nClientFromRequest(request);

    if (!client) {
      return NextResponse.json(
        { error: 'n8n not configured. Set NEXT_PUBLIC_N8N_URL and N8N_API_KEY or provide X-N8N-URL header' },
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
      { error: error.message || 'Failed to fetch workflows' },
      { status: 500 }
    );
  }
}
