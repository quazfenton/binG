/**
 * Consolidated Events API
 * 
 * Routes:
 * - GET /api/events?action=list - List events
 * - POST /api/events?action=emit - Emit event
 * - POST /api/events?action=replay - Replay failed events
 * - GET /api/events?action=stats - Get event statistics
 * - POST /api/events?action=purge - Purge old events
 * - GET /api/events?action=stream - SSE stream for real-time updates
 */

import { NextRequest, NextResponse } from 'next/server';

// Import handlers from existing route files
import { GET as listGET, POST as emitPOST } from './main';
import { GET as streamGET } from './stream/gateway';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';

  switch (action) {
    case 'list':
      return listGET(request);
    case 'stats':
      // Inline stats handler
      try {
        const { getEventStats } = await import('@/lib/events');
        const stats = await getEventStats();
        return NextResponse.json({ success: true, stats });
      } catch {
        return NextResponse.json({ stats: {} });
      }
    case 'stream':
      return streamGET(request);
    default:
      return listGET(request);
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'emit';

  switch (action) {
    case 'emit':
      return emitPOST(request);
    case 'replay':
      try {
        const { replayFailedEvents } = await import('@/lib/events');
        const body = await request.json();
        const result = await replayFailedEvents(body.userId);
        return NextResponse.json({ success: true, result });
      } catch {
        return NextResponse.json({ error: 'Failed to replay events' }, { status: 500 });
      }
    case 'purge':
      try {
        const { purgeOldEvents } = await import('@/lib/events');
        const body = await request.json();
        const result = await purgeOldEvents(body.olderThan);
        return NextResponse.json({ success: true, result });
      } catch {
        return NextResponse.json({ error: 'Failed to purge events' }, { status: 500 });
      }
    default:
      return emitPOST(request);
  }
}