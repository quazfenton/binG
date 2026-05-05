/**
 * Music Statistics API
 *
 * GET /api/music/visualizer/stats - Get music statistics
 */

import { NextRequest, NextResponse } from 'next/server';


import { getVisualizerStats } from '@/lib/music/music-visualizer';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Music:Visualizer:Stats');

export async function GET() {
  try {
    const stats = await getVisualizerStats();

    return NextResponse.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error('Failed to get stats:', error);
    return NextResponse.json(
      { error: 'Failed to get statistics' },
      { status: 500 }
    );
  }
}
