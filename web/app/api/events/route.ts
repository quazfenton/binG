import { NextRequest, NextResponse } from 'next/server';
import { GET as listGET, POST as emitPOST } from './main';
import { GET as streamGET } from './stream/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3 && segments[2] === 'stream') return streamGET(request);
  if (segments.length === 3 && segments[2] === 'stats') {
    try {
      const { getEventStats } = await import('@/lib/events');
      return NextResponse.json({ success: true, stats: await getEventStats() });
    } catch {
      return NextResponse.json({ stats: {} });
    }
  }
  return listGET(request);
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length !== 3) return emitPOST(request);
  if (segments[2] === 'replay') {
    try {
      const { replayFailedEvents } = await import('@/lib/events');
      return NextResponse.json({ success: true, result: await replayFailedEvents((await request.json()).userId) });
    } catch { return NextResponse.json({ error: 'Failed to replay events' }, { status: 500 }); }
  }
  if (segments[2] === 'purge') {
    try {
      const { purgeOldEvents } = await import('@/lib/events');
      return NextResponse.json({ success: true, result: await purgeOldEvents((await request.json()).olderThan) });
    } catch { return NextResponse.json({ error: 'Failed to purge events' }, { status: 500 }); }
  }
  return emitPOST(request);
}