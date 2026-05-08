import { NextRequest, NextResponse } from 'next/server';
import { GET as agentsGET, POST as agentsPOST } from './agents/gateway';
import { POST as agentActionPOST } from './agents/[id]/[action]/gateway';
import { GET as statsGET } from './stats/gateway';
import { GET as workflowsGET, POST as workflowPOST } from './workflows/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3 && segments[2] === 'agents') return agentsGET(request);
  if (segments.length === 3 && segments[2] === 'stats') return statsGET();
  if (segments.length === 3 && segments[2] === 'workflows') return workflowsGET(request);
  return agentsGET(request);
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 5 && segments[2] === 'agents') {
    return agentActionPOST(request, { params: Promise.resolve({ id: segments[3], action: segments[4] }) });
  }
  if (segments.length === 4 && segments[2] === 'workflows') {
    return workflowPOST(request, { params: Promise.resolve({ id: segments[3] }) });
  }
  return agentsPOST(request);
}