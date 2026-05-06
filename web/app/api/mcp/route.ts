import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET, POST as rootPOST } from './main';
import { POST as connectPOST } from './connect/gateway';
import { POST as initPOST } from './init/gateway';
import { GET as statusGET } from './status/gateway';
import { GET as storeGET, POST as storePOST, DELETE as storeDELETE } from './store/gateway';
import { POST as storeSyncPOST } from './store/sync/gateway';

// GET /api/mcp | /api/mcp/status | /api/mcp/store
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3) {
    if (segments[2] === 'status') return statusGET();
    if (segments[2] === 'store') return storeGET(request);
    return rootGET(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// POST /api/mcp/connect | /api/mcp/init | /api/mcp/store | /api/mcp/store/sync
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3) {
    if (segments[2] === 'connect') return connectPOST(request);
    if (segments[2] === 'init') return initPOST();
    if (segments[2] === 'store') return storePOST(request);
    return rootPOST(request);
  }

  if (segments.length === 4 && segments[2] === 'store' && segments[3] === 'sync') {
    return storeSyncPOST(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// DELETE /api/mcp/store
export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && segments[2] === 'store') {
    return storeDELETE(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}