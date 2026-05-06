import { NextRequest, NextResponse } from 'next/server';

import { POST as agentPOST } from './agent/gateway';
import { GET as clearSessionsGET, POST as clearSessionsPOST } from './clear-sessions/gateway';
import { GET as daemonGET, POST as daemonPOST, DELETE as daemonDELETE } from './daemon/gateway';
import { GET as devboxGET, POST as devboxPOST, DELETE as devboxDELETE } from './devbox/gateway';
import { POST as executePOST } from './execute/gateway';
import { GET as filesGET } from './files/gateway';
import { POST as lifecyclePOST } from './lifecycle/gateway';
import { GET as ptyGET, POST as ptyPOST } from './provider/pty/gateway';
import { GET as sessionGET, POST as sessionPOST, DELETE as sessionDELETE, PATCH as sessionPATCH } from './session/gateway';
import { GET as syncGET, POST as syncPOST } from './sync/gateway';
import { POST as terminalInputPOST } from './terminal/input/gateway';
import { POST as terminalResizePOST } from './terminal/resize/gateway';
import { POST as terminalPOST, DELETE as terminalDELETE } from './terminal/gateway';
import { GET as terminalStreamGET, POST as terminalStreamPOST } from './terminal/stream/gateway';
import { GET as terminalWsGET } from './terminal/ws/gateway';
import { GET as terminaluseGET, POST as terminalusePOST } from './terminaluse/gateway';
import { POST as webcontainerPOST } from './webcontainer/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /sandbox/...' }, { status: 404 });
  }

  switch (segments[2]) {
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
      return NextResponse.json({ error: 'Not found. Use /sandbox/...' }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /sandbox/...' }, { status: 404 });
  }

  switch (segments[2]) {
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
      return NextResponse.json({ error: 'Not found. Use /sandbox/...' }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /sandbox/daemon|/sandbox/devbox|/sandbox/session|/sandbox/terminal' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'daemon':
      return daemonDELETE(request);
    case 'devbox':
      return devboxDELETE(request);
    case 'session':
      return sessionDELETE(request);
    case 'terminal':
      return terminalDELETE(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /sandbox/daemon|/sandbox/devbox|/sandbox/session|/sandbox/terminal' }, { status: 404 });
  }
}

export async function PATCH(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /sandbox/session' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'session':
      return sessionPATCH(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /sandbox/session' }, { status: 404 });
  }
}