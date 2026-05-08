/**
 * Desktop API Endpoint
 * Consolidated route — dispatches to sub-handler route.ts files.
 *
 * Endpoints:
 * - POST /api/desktop - Create desktop (main.ts)
 * - GET  /api/desktop/:id - Get desktop info (see [id]/gateway.ts)
 * - DELETE /api/desktop/:id - Close desktop (see [id]/gateway.ts)
 * - POST /api/desktop/:id/:action - Execute action (see [id]/[action]/gateway.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

import { POST as rootPOST } from './main';
import { GET as idGET, DELETE as idDELETE } from './[id]/gateway';
import { POST as actionPOST } from './[id]/[action]/gateway';

type Params = { params: Promise<{ id?: string; action?: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  // /api/desktop/:id/:action -> action gateway
  if (segments.length >= 5) {
    return actionPOST(request, { params: params as Promise<{ id: string; action: string }> });
  }

  // /api/desktop -> main handler (create)
  return rootPOST(request);
}

export async function GET(request: NextRequest, { params }: Params) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  if (segments.length < 4) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return idGET(request, { params: params as Promise<{ id: string }> });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  if (segments.length < 4) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return idDELETE(request, { params: params as Promise<{ id: string }> });
}