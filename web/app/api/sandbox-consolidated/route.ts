import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as agentGET, POST as agentPOST } from './agent/route';
import { POST as clearSessionsPOST } from './clear-sessions/route';
import { GET as daemonGET, POST as daemonPOST } from './daemon/route';
import { GET as devboxGET, POST as devboxPOST } from './devbox/route';
import { POST as executePOST } from './execute/route';
import { GET as filesGET, POST as filesPOST } from './files/route';
import { GET as lifecycleGET, POST as lifecyclePOST, DELETE as lifecycleDELETE } from './lifecycle/route';
import { POST as ptyPOST } from './provider/pty/route';
import { GET as sessionGET, POST as sessionPOST, DELETE as sessionDELETE } from './session/route';
import { POST as syncPOST } from './sync/route';
import { POST as terminalInputPOST } from './terminal/input/route';
import { POST as terminalResizePOST } from './terminal/resize/route';
import { GET as terminalGET, POST as terminalPOST } from './terminal/route';
import { GET as terminalStreamGET } from './terminal/stream/route';
import { GET as terminalWsGET } from './terminal/ws/route';
import { POST as terminalusePOST } from './terminaluse/route';
import { GET as webcontainerGET, POST as webcontainerPOST } from './webcontainer/route';

/**
 * Consolidated sandbox route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'agent':
      return agentGET(request);
    case 'daemon':
      return daemonGET(request);
    case 'devbox':
      return devboxGET(request);
    case 'files':
      return filesGET(request);
    case 'lifecycle':
      return lifecycleGET(request);
    case 'session':
      return sessionGET(request);
    case 'terminal':
      return terminalGET(request);
    case 'terminal-stream':
      return terminalStreamGET(request);
    case 'terminal-ws':
      return terminalWsGET(request);
    case 'webcontainer':
      return webcontainerGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=agent|daemon|devbox|files|lifecycle|session|terminal|terminal-stream|terminal-ws|webcontainer' }),
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
    case 'clear-sessions':
      return clearSessionsPOST(request);
    case 'daemon':
      return daemonPOST(request);
    case 'devbox':
      return devboxPOST(request);
    case 'execute':
      return executePOST(request);
    case 'files':
      return filesPOST(request);
    case 'lifecycle':
      return lifecyclePOST(request);
    case 'pty':
      return ptyPOST(request);
    case 'session':
      return sessionPOST(request);
    case 'sync':
      return syncPOST(request);
    case 'terminal':
      return terminalPOST(request);
    case 'terminal-input':
      return terminalInputPOST(request);
    case 'terminal-resize':
      return terminalResizePOST(request);
    case 'terminaluse':
      return terminalusePOST(request);
    case 'webcontainer':
      return webcontainerPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=agent|clear-sessions|daemon|devbox|execute|files|lifecycle|pty|session|sync|terminal|terminal-input|terminal-resize|terminaluse|webcontainer' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'lifecycle':
      return lifecycleDELETE(request);
    case 'session':
      return sessionDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=lifecycle|session' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}