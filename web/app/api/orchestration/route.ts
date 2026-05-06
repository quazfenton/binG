import { NextRequest } from 'next/server';
import { GET as agentsGET, POST as agentsPOST } from './agents/gateway';
import { POST as agentActionPOST } from './agents/[id]/[action]/gateway';
import { GET as statsGET } from './stats/gateway';
import { GET as workflowsGET, POST as workflowPOST } from './workflows/gateway';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get('resource');

  switch (resource) {
    case 'agents':
      return agentsGET(request);
    case 'stats':
      return statsGET();
    case 'workflows':
      return workflowsGET(request);
    default:
      return agentsGET(request);
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get('resource');

  // Check if this is an agent action (has id and action params)
  if (searchParams.get('id') && searchParams.get('action')) {
    const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);
    const id = pathParts[4] || searchParams.get('id') || '';
    const action = pathParts[5] || searchParams.get('action') || '';
    return agentActionPOST(request, { params: Promise.resolve({ id, action }) });
  }

  switch (resource) {
    case 'agents':
    case 'start':
    case 'stop':
    case 'pause':
    case 'resume':
    case 'work':
      return agentsPOST(request);
    case 'workflows':
    case 'workflow': {
      const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);
      const id = pathParts[3] || '';
      return workflowPOST(request, { params: Promise.resolve({ id }) });
    }
    default:
      return agentsPOST(request);
  }
}