import { NextRequest, NextResponse } from 'next/server';

import { GET as searchGET } from './search/gateway';
import { POST as sendPOST } from './send/gateway';
import { GET as streamGET } from './stream/gateway';

// GET /api/messaging/search | /api/messaging/stream
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3) {
    if (segments[2] === 'stream') return streamGET(request);
    // 'search' and default → search
    return searchGET(request);
  }

  return searchGET(request);
}

// POST /api/messaging/send
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && segments[2] === 'send') {
    return sendPOST(request);
  }

  return NextResponse.json(
    { error: 'Not found. Use /messaging/send' },
    { status: 404 }
  );
}