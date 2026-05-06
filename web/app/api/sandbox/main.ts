import { NextRequest } from 'next/server';

// Import all existing handlers
import { POST as agentPOST } from './agent/route';
import { GET as clearSessionsGET, POST as clearSessionsPOST } from './clear-sessions/route';
import { GET as daemonGET, POST as daemonPOST, DELETE as daemonDELETE } from './daemon/route';
import { GET as devboxGET, POST as devboxPOST, DELETE as devboxDELETE } from './devbox/route';
import { POST as executePOST } from './execute/route';
import { GET as filesGET } from './files/route';
import { POST as lifecyclePOST } from './lifecycle/route';
import { GET as ptyGET, POST as ptyPOST } from './provider/pty/route';
import { GET as sessionGET, POST as sessionPOST, DELETE as sessionDELETE, PATCH as sessionPATCH } from './session/route';
import { GET as syncGET, POST as syncPOST } from './sync/route';
import { POST as terminalInputPOST } from './terminal/input/route';
import { POST as terminalResizePOST } from './terminal/resize/route';
import { POST as terminalPOST, DELETE as terminalDELETE } from './terminal/route';
import { GET as terminalStreamGET, POST as terminalStreamPOST } from './terminal/stream/route';
import { GET as terminalWsGET } from './terminal/ws/route';
import { GET as terminaluseGET, POST as terminalusePOST } from './terminaluse/route';
import { POST as webcontainerPOST } from './webcontainer/route';

/**
 * Consolidated sandbox route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'clear-sessions':
      return clearSessionsGET(request);
    case 'daemon':
      return daemonGET(request);
    case 'devbox':
      return devboxGET(request);
    case 'files':
      return filesGET(request);
    case 'pty':
      return ptyGET();
    case 'session':
      return sessionGET(request);
    case 'sync':
      return syncGET(request);
    case 'terminal-stream':
      return terminalStreamGET(request);
    case 'terminal-ws':
      return terminalWsGET(request);
    case 'terminaluse':
      return terminaluseGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=clear-sessions|daemon|devbox|files|pty|session|sync|terminal-stream|terminal-ws|terminaluse' }),
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
    case 'terminal-stream':
      return terminalStreamPOST(request);
    case 'terminaluse':
      return terminalusePOST(request);
    case 'webcontainer':
      return webcontainerPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=agent|clear-sessions|daemon|devbox|execute|lifecycle|pty|session|sync|terminal|terminal-input|terminal-resize|terminal-stream|terminaluse|webcontainer' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'daemon':
      return daemonDELETE(request);
    case 'devbox':
      return devboxDELETE(request);
    case 'session':
      return sessionDELETE(request);
    case 'terminal':
      return terminalDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=daemon|devbox|session|terminal' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function PATCH(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'session':
      return sessionPATCH(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=session' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}