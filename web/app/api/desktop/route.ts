/**
 * Desktop API Endpoint
 * Consolidated route — dispatches to sub-handler gateway files.
 *
 * Endpoints:
 * - POST /api/desktop - Create desktop (main.ts)
 * - GET  /api/desktop/:id - Get desktop info (see [id]/gateway.ts)
 * - DELETE /api/desktop/:id - Close desktop (see [id]/gateway.ts)
 * - POST /api/desktop/:id/:action - Execute action (see [id]/[action]/gateway.ts)
 * - POST /api/desktop/:id/recording/:subAction - Recording control (see [id]/recording/gateway.ts)
 * - GET  /api/desktop/:id/recording/:subAction - Recording status (see [id]/recording/gateway.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

import { POST as rootPOST } from './main';
import { GET as idGET, DELETE as idDELETE } from './[id]/gateway';
import { POST as actionPOST } from './[id]/[action]/gateway';
import {
  POST as recordingPOST,
  GET as recordingGET,
} from './[id]/recording/gateway';

type Params = { params: Promise<{ id?: string; action?: string }> };

/**
 * Check whether the request path targets the recording sub-route.
 * /api/desktop/:id/recording/...
 */
function isRecordingPath(segments: string[]): boolean {
  return segments.length >= 5 && segments[3] === 'recording';
}

// ─── POST ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: Params) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/desktop/:id/recording/:subAction -> recording gateway
  if (isRecordingPath(segments)) {
    return recordingPOST(request, {
      params: Promise.resolve({
        id: segments[2],
        subAction: segments[4],
      }),
    });
  }

  // /api/desktop/:id/:action -> action gateway
  if (segments.length >= 5) {
    return actionPOST(request, { params: params as Promise<{ id: string; action: string }> });
  }

  // /api/desktop -> main handler (create)
  return rootPOST(request);
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: Params) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/desktop/:id/recording/:subAction -> recording gateway
  if (isRecordingPath(segments)) {
    return recordingGET(request, {
      params: Promise.resolve({
        id: segments[2],
        subAction: segments[4],
      }),
    });
  }

  // /api/desktop/:id -> id gateway
  if (segments.length < 4) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return idGET(request, { params: params as Promise<{ id: string }> });
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: Params) {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  if (segments.length < 4) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return idDELETE(request, { params: params as Promise<{ id: string }> });
}