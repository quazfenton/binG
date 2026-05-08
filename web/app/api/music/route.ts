import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET } from './main';
import { getVisualizerModes, getVisualizerStats, getTracks } from '@/lib/music/music-visualizer';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Music');

// GET /api/music | /api/music/visualizer/modes | /api/music/visualizer/stats | /api/music/visualizer/tracks
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  // /api/music/visualizer/modes — 4 segments: api, music, visualizer, modes
  if (segments.length === 4 && segments[2] === 'visualizer' && segments[3] === 'modes') {
    try {
      const modes = await getVisualizerModes();
      return NextResponse.json({ success: true, modes });
    } catch (error: any) {
      logger.error('Failed to get modes:', error);
      return NextResponse.json({ error: 'Failed to get visualizer modes' }, { status: 500 });
    }
  }

  // /api/music/visualizer/stats — 4 segments: api, music, visualizer, stats
  if (segments.length === 4 && segments[2] === 'visualizer' && segments[3] === 'stats') {
    try {
      const stats = await getVisualizerStats();
      return NextResponse.json({ success: true, stats });
    } catch (error: any) {
      logger.error('Failed to get stats:', error);
      return NextResponse.json({ error: 'Failed to get statistics' }, { status: 500 });
    }
  }

  // /api/music/visualizer/tracks — 4 segments: api, music, visualizer, tracks
  if (segments.length === 4 && segments[2] === 'visualizer' && segments[3] === 'tracks') {
    try {
      const searchParams = request.nextUrl.searchParams;
      const limit = parseInt(searchParams.get('limit') || '50');
      const tracks = await getTracks(limit);
      return NextResponse.json({ success: true, tracks, count: tracks.length });
    } catch (error: any) {
      logger.error('Failed to get tracks:', error);
      return NextResponse.json({ error: 'Failed to get tracks' }, { status: 500 });
    }
  }

  // /api/music — root handler
  return rootGET(request);
}

