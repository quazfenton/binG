import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as healthGET } from './health/gateway';
import { POST as agentPOST } from './main';
import { POST as statefulAgentPOST } from './stateful-agent/gateway';
import { POST as interruptPOST } from './stateful-agent/interrupt/gateway';
import { POST as unifiedAgentPOST } from './unified-agent/gateway';
import { POST as cloudOffloadPOST } from './v2/cloud/offload/gateway';
import { GET as cloudAgentGET, POST as cloudAgentPOST, DELETE as cloudAgentDELETE } from './v2/cloud/[agentId]/gateway';
import { POST as v2ExecutePOST } from './v2/execute/gateway';
import { GET as v2SessionGET, POST as v2SessionPOST, DELETE as v2SessionDELETE } from './v2/session/gateway';
import { POST as v2SyncPOST } from './v2/sync/gateway';
import { POST as v2WorkforcePOST } from './v2/workforce/gateway';
import { GET as workflowsGET, POST as workflowsPOST } from './workflows/gateway';

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
    case 'cloud-agent': {
      const agentId = searchParams.get('agentId');
      if (!agentId) {
        return new Response(
          JSON.stringify({ error: 'agentId query parameter is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return cloudAgentGET(request, { params: Promise.resolve({ agentId }) });
    }
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
    case 'cloud-agent': {
      const agentId = searchParams.get('agentId');
      if (!agentId) {
        return new Response(
          JSON.stringify({ error: 'agentId query parameter is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return cloudAgentPOST(request, { params: Promise.resolve({ agentId }) });
    }
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
    case 'cloud-agent': {
      const agentId = searchParams.get('agentId');
      if (!agentId) {
        return new Response(
          JSON.stringify({ error: 'agentId query parameter is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return cloudAgentDELETE(request, { params: Promise.resolve({ agentId }) });
    }
    case 'v2-session':
      return v2SessionDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=cloud-agent|v2-session' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}