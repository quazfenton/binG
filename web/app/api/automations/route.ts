import { NextRequest, NextResponse } from 'next/server';

import { GET as workflowsGET } from './n8n/workflows/gateway';
import { POST as executePOST } from './n8n/workflows/[id]/execute/gateway';
import { GET as executionsGET } from './n8n/workflows/[id]/executions/gateway';

type IdParams = { params: Promise<{ id: string }> };

// GET /api/automations/n8n/workflows | /api/automations/n8n/workflows/:id/executions
export async function GET(request: NextRequest, { params }: IdParams) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  // /api/automations/n8n/workflows/:id/executions
  if (segments.length === 6 && segments[5] === 'executions') {
    return executionsGET(request, { params });
  }

  // /api/automations/n8n/workflows
  return workflowsGET(request);
}

// POST /api/automations/n8n/workflows/:id/execute
export async function POST(request: NextRequest, { params }: IdParams) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 5 && segments[4] === 'execute') {
    return executePOST(request, { params });
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
