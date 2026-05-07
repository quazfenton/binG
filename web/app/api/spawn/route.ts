/**
 * AI Agents API (Spawn)
 * Consolidated route — dispatches to sub-handler route.ts files.
 *
 * Endpoints:
 * - GET  /api/spawn - List all agents (main.ts)
 * - POST /api/spawn - Create/start agent (main.ts)
 * - GET  /api/spawn/:id - Get agent details (see [id]/route.ts)
 * - POST /api/spawn/:id - Send prompt (see [id]/route.ts)
 * - DELETE /api/spawn/:id - Stop agent (see [id]/route.ts)
 * - GET  /api/spawn/:id/events - Subscribe to events (SSE) (see [id]/route.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET, POST as rootPOST } from './main';
import { GET as idGET, POST as idPOST, DELETE as idDELETE } from './[id]/gateway';
import { GET as eventsGET } from './[id]/events/gateway';

type Params = { params?: Promise<{ id?: string; action?: string }> };

export async function GET(request: NextRequest, { params }: Params = {}) {
  const path = request.nextUrl?.pathname ?? request.url ?? '';
  const resolvedParams = params ? await params : {};

  // /api/spawn/:id/events -> events gateway
  if (path.includes('/events')) {
    return eventsGET(request, { params: resolvedParams as Promise<{ id: string }> });
  }

  // /api/spawn/:id -> [id] gateway
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 4) {
    return idGET(request, { params: resolvedParams as Promise<{ id: string }> });
  }

  // /api/spawn -> main handler
  return rootGET(request);
}

export async function POST(request: NextRequest, { params }: Params = {}) {
  const path = request.nextUrl?.pathname ?? request.url ?? '';
  const segments = path.split('/').filter(Boolean);

  if (segments.length >= 4 && params) {
    return idPOST(request, { params: params as Promise<{ id: string }> });
  }

  return rootPOST(request);
}

export async function DELETE(request: NextRequest, { params }: Params = {}) {
  const path = request.nextUrl?.pathname ?? request.url ?? '';
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 4 || !params) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return idDELETE(request, { params: params as Promise<{ id: string }> });
}