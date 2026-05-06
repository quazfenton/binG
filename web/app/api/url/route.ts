import { NextRequest, NextResponse } from 'next/server';

import { POST as shortenPOST } from './shorten/gateway';
import { GET as redirectGET } from './redirect/[id]/gateway';

type IdParams = { params: Promise<{ id: string }> };

// POST /api/url/shorten
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.endsWith('/shorten')) {
    return shortenPOST(request);
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// GET /api/url/redirect/:id
export async function GET(request: NextRequest, { params }: IdParams) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 4 && segments[3] === 'redirect') {
    return redirectGET(request, { params });
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}