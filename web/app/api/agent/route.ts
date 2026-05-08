import { NextRequest, NextResponse } from 'next/server';

import { GET as healthGET } from './health/gateway';
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

// GET /api/agent/health | /api/agent/[agentId] | /api/agent/v2-session | /api/agent/workflows
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 4 && segments[2] === 'cloud') {
    return cloudAgentGET(request, { params: Promise.resolve({ agentId: segments[3] }) });
  }

  if (segments.length === 3) {
    switch (segments[2]) {
      case 'health': return healthGET(request);
      case 'v2-session': return v2SessionGET(request);
      case 'workflows': return workflowsGET(request);
      default:
        return NextResponse.json(
          { error: 'Not found. Use /agent/health|/agent/v2-session|/agent/workflows|/agent/cloud/[agentId]' },
          { status: 404 }
        );
    }
  }

  return NextResponse.json(
    { error: 'Not found. Use /agent/health|/agent/v2-session|/agent/workflows|/agent/cloud/[agentId]' },
    { status: 404 }
  );
}

// POST /api/agent/agent | /api/agent/stateful-agent | /api/agent/cloud/offload | /api/agent/cloud/[agentId] | /api/agent/v2-execute | /api/agent/v2-session | /api/agent/v2-sync | /api/agent/v2-workforce | /api/agent/workflows | /api/agent/interrupt | /api/agent/unified-agent
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 4 && segments[2] === 'cloud') {
    // POST /api/agent/cloud/[agentId]
    return cloudAgentPOST(request, { params: Promise.resolve({ agentId: segments[3] }) });
  }

  if (segments.length === 3) {
    switch (segments[2]) {
      case 'stateful-agent': return statefulAgentPOST(request);
      case 'interrupt': return interruptPOST(request);
      case 'unified-agent': return unifiedAgentPOST(request);
      case 'cloud-offload': return cloudOffloadPOST(request);
      case 'v2-execute': return v2ExecutePOST(request);
      case 'v2-session': return v2SessionPOST(request);
      case 'v2-sync': return v2SyncPOST(request);
      case 'v2-workforce': return v2WorkforcePOST(request);
      case 'workflows': return workflowsPOST(request);
      default:
        return NextResponse.json(
          { error: 'Not found. Use /agent/agent|/agent/stateful-agent|/agent/cloud-offload|/agent/cloud/[agentId]|/agent/v2-execute|/agent/v2-session|/agent/v2-sync|/agent/v2-workforce|/agent/workflows|/agent/interrupt|/agent/unified-agent' },
          { status: 404 }
        );
    }
  }

  return NextResponse.json(
    { error: 'Not found. Use /agent/agent|/agent/stateful-agent|/agent/cloud-offload|/agent/cloud/[agentId]|/agent/v2-execute|/agent/v2-session|/agent/v2-sync|/agent/v2-workforce|/agent/workflows|/agent/interrupt|/agent/unified-agent' },
    { status: 404 }
  );
}

// DELETE /api/agent/cloud/[agentId] | /api/agent/v2-session
export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 4 && segments[2] === 'cloud') {
    // DELETE /api/agent/cloud/[agentId]
    return cloudAgentDELETE(request, { params: Promise.resolve({ agentId: segments[3] }) });
  }

  if (segments.length === 3 && segments[2] === 'v2-session') {
    return v2SessionDELETE(request);
  }

  return NextResponse.json(
    { error: 'Not found. Use /agent/cloud/[agentId]|/agent/v2-session' },
    { status: 404 }
  );
}