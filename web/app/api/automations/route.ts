import { NextRequest, NextResponse } from 'next/server';
import { GET as workflowsGET } from './n8n/workflows/gateway';
import { POST as executePOST } from './n8n/workflows/[id]/execute/gateway';
import { GET as executionsGET } from './n8n/workflows/[id]/executions/gateway';

/**
 * Consolidated automations route
 * Preserved original at ./main.ts
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/automations/n8n/workflows/:id/executions
  if (pathParts.includes('executions')) {
    return executionsGET(request);
  }

  // /api/automations/n8n/workflows - List workflows
  return workflowsGET(request);
}

export async function POST(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/automations/n8n/workflows/:id/execute
  if (pathParts.includes('execute')) {
    return executePOST(request);
  }

  return new NextResponse(
    JSON.stringify({ error: 'POST not available at this path' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
}