import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET, POST as rootPOST } from './main';
import { GET as statsGET } from './stats/gateway';
import { GET as chainsGET } from './chains/gateway';
import { GET as chainByIdGET } from './chains/[id]/gateway';
import { GET as getMindMapGET, PUT as updateMindMapPUT, DELETE as deleteMindMapDELETE } from './[id]/gateway';

type IdParams = { params: Promise<{ id: string }> };

// GET /api/mind-map | /api/mind-map/stats | /api/mind-map/chains | /api/mind-map/chains/:id | /api/mind-map/:id
export async function GET(request: NextRequest, { params }: IdParams) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 5 && segments[3] === 'chains') {
    return chainByIdGET(request, { params });
  }

  if (path.endsWith('/chains')) {
    return chainsGET(request);
  }

  if (path.endsWith('/stats')) {
    return statsGET();
  }

  if (segments.length === 4) {
    return getMindMapGET(request, { params });
  }

  return rootGET(request);
}

// POST /api/mind-map
export async function POST(request: NextRequest) {
  return rootPOST(request);
}

// PUT /api/mind-map/:id
export async function PUT(request: NextRequest, { params }: IdParams) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 4) {
    return updateMindMapPUT(request, { params });
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// DELETE /api/mind-map/:id
export async function DELETE(request: NextRequest, { params }: IdParams) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 4) {
    return deleteMindMapDELETE(request, { params });
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
