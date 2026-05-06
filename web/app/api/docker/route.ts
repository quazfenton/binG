import { NextRequest, NextResponse } from 'next/server';

import { GET as containersGET } from './containers/gateway';
import { POST as composePOST } from './compose/gateway';
import { POST as execPOST } from './exec/gateway';
import { POST as startPOST } from './start/[id]/gateway';
import { POST as stopPOST } from './stop/[id]/gateway';
import { DELETE as removeDELETE } from './remove/[id]/gateway';

type Params = { params: Promise<{ id: string }> };

// GET /api/docker/containers
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.endsWith('/containers')) {
    return containersGET(request);
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// POST /api/docker/compose | /api/docker/exec | /api/docker/start/:id | /api/docker/stop/:id
export async function POST(request: NextRequest, { params }: Params) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  // /api/docker/compose — 4 segments: [api, docker, compose]
  if (segments.length === 3 && segments[2] === 'compose') {
    return composePOST(request);
  }

  // /api/docker/exec — 4 segments: [api, docker, exec]
  if (segments.length === 3 && segments[2] === 'exec') {
    return execPOST(request);
  }

  // /api/docker/start/:id — 5 segments: [api, docker, start, id]
  if (segments.length === 4 && segments[2] === 'start') {
    return startPOST(request, { params });
  }

  // /api/docker/stop/:id — 5 segments: [api, docker, stop, id]
  if (segments.length === 4 && segments[2] === 'stop') {
    return stopPOST(request, { params });
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// DELETE /api/docker/remove/:id
export async function DELETE(request: NextRequest, { params }: Params) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  // /api/docker/remove/:id — 5 segments: [api, docker, remove, id]
  if (segments.length === 4 && segments[2] === 'remove') {
    return removeDELETE(request, { params });
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}