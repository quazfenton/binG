/**
 * Cron Jobs API
 * Consolidated route — dispatches to sub-handler gateway.ts files.
 *
 * Endpoints:
 * - GET  /api/cron-jobs - List user's cron jobs (main.ts)
 * - POST /api/cron-jobs - Create cron job (main.ts)
 * - PUT  /api/cron-jobs/:id - Update cron job (see [id]/gateway.ts)
 * - DELETE /api/cron-jobs/:id - Delete cron job (see [id]/gateway.ts)
 * - POST /api/cron-jobs/:id/trigger - Manually trigger job (see [id]/trigger/gateway.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET, POST as rootPOST } from './main';
import { PUT as idPUT, DELETE as idDELETE } from './[id]/gateway';
import { POST as triggerPOST } from './[id]/trigger/gateway';

export async function GET(request: NextRequest) {
  return rootGET(request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const path = request.nextUrl.pathname;

  // /api/cron-jobs/:id/trigger -> trigger gateway
  if (path.includes('/trigger')) {
    return triggerPOST(request, { params });
  }

  // /api/cron-jobs -> main handler
  return rootPOST(request);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return idPUT(request, { params });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return idDELETE(request, { params });
}