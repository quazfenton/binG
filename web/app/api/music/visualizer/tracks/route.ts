/**
 * Music Visualizer API
 *
 * GET /api/music/visualizer/tracks - Get tracks
 * GET /api/music/visualizer/modes - Get visualizer modes
 * GET /api/music/visualizer/stats - Get statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTracks, getVisualizerModes, getVisualizerStats } from '@/lib/music/music-visualizer';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Music:Visualizer');

// GET - List tracks
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');

    const tracks = await getTracks(limit);

    return NextResponse.json({
      success: true,
      tracks,
      count: tracks.length,
    });
  } catch (error: any) {
    logger.error('Failed to get tracks:', error);
    return NextResponse.json(
      { error: 'Failed to get tracks' },
      { status: 500 }
    );
  }
}
