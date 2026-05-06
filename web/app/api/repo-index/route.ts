/**
 * Repo Index API
 * Consolidated route — dispatches to sub-handler gateway.ts files.
 *
 * Endpoints:
 * - GET  /api/repo-index - Search code (main.ts)
 * - POST /api/repo-index - Index files/directory (main.ts)
 * - DELETE /api/repo-index - Clear index (main.ts)
 * - GET  /api/repo-index/stats - Get index statistics (stats/gateway.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET, POST as rootPOST, DELETE as rootDELETE } from './main';
import { GET as statsGET } from './stats/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/repo-index/stats -> stats gateway
  if (path.endsWith('/stats')) {
    return statsGET(request);
  }

  // /api/repo-index -> main handler
  return rootGET(request);
}

export async function POST(request: NextRequest) {
  return rootPOST(request);
}

export async function DELETE(request: NextRequest) {
  return rootDELETE(request);
}