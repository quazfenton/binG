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

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/desktop/:id/:action -> action gateway
  // Action paths have more segments after the area prefix
  const segments = path.split('/').filter(Boolean);
  // segments: ['', 'api', 'desktop', id, action]
  // If there are 5+ segments, it's a dynamic action path
  if (segments.length >= 5) {
    return actionPOST(request);
  }

  // /api/desktop -> main handler (create)
  return rootPOST(request);
}

export async function GET(request: NextRequest) {
  return idGET(request);
}

export async function DELETE(request: NextRequest) {
  return idDELETE(request);
}