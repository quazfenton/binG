import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as healthGET } from './health/route';
import { POST as agentPOST } from './route';
import { POST as statefulAgentPOST } from './stateful-agent/route';
import { POST as interruptPOST } from './stateful-agent/interrupt/route';
import { POST as unifiedAgentPOST } from './unified-agent/route';
import { POST as cloudOffloadPOST } from './v2/cloud/offload/route';
import { GET as cloudAgentGET, POST as cloudAgentPOST, DELETE as cloudAgentDELETE } from './v2/cloud/[agentId]/route';
import { POST as v2ExecutePOST } from './v2/execute/route';
import { GET as v2SessionGET, POST as v2SessionPOST } from './v2/session/route';
import { POST as v2SyncPOST } from './v2/sync/route';
import { POST as v2WorkforcePOST } from './v2/workforce/route';
import { GET as workflowsGET, POST as workflowsPOST } from './workflows/route';

/**
 * Consolidated agent route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'health':
      return healthGET(request);
    case 'cloud-agent':
      return cloudAgentGET(request);
    case 'v2-session':
      return v2SessionGET(request);
    case 'workflows':
      return workflowsGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=health|cloud-agent|v2-session|workflows' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'agent':
      return agentPOST(request);
    case 'stateful-agent':
      return statefulAgentPOST(request);
    case 'interrupt':
      return interruptPOST(request);
    case 'unified-agent':
      return unifiedAgentPOST(request);
    case 'cloud-offload':
      return cloudOffloadPOST(request);
    case 'cloud-agent':
      return cloudAgentPOST(request);
    case 'v2-execute':
      return v2ExecutePOST(request);
    case 'v2-session':
      return v2SessionPOST(request);
    case 'v2-sync':
      return v2SyncPOST(request);
    case 'v2-workforce':
      return v2WorkforcePOST(request);
    case 'workflows':
      return workflowsPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=agent|stateful-agent|interrupt|unified-agent|cloud-offload|cloud-agent|v2-execute|v2-session|v2-sync|v2-workforce|workflows' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'cloud-agent':
      return cloudAgentDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=cloud-agent' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}