import { NextRequest, NextResponse } from 'next/server';

import { GET as playlistGET, POST as playlistPOST } from './playlist/gateway';
import { GET as webhookGET, POST as webhookPOST } from './webhook/gateway';
import { GET as embedGET } from './embed/[videoId]/gateway';

type VideoIdParams = { params: Promise<{ videoId: string }> };

// GET /api/music-hub/playlist | /api/music-hub/webhook | /api/music-hub/embed/:videoId
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.endsWith('/playlist')) {
    return playlistGET(request);
  }
  if (path.endsWith('/webhook')) {
    return webhookGET();
  }
  // /api/music-hub/embed/:videoId — segments: ['', 'api', 'music-hub', 'embed', videoId]
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 5 && segments[3] === 'embed') {
    return embedGET(request, { params: Promise.resolve({ videoId: segments[4] }) });
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// POST /api/music-hub/playlist | /api/music-hub/webhook
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.endsWith('/playlist')) {
    return playlistPOST(request);
  }
  if (path.endsWith('/webhook')) {
    return webhookPOST(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}