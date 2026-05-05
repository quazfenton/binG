/**
 * Visualizer Modes API
 *
 * GET /api/music/visualizer/modes - Get available visualizer modes
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getVisualizerModes } from '@/lib/music/music-visualizer';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Music:Visualizer:Modes');

export async function GET() {
  try {
    const modes = await getVisualizerModes();

    return NextResponse.json({
      success: true,
      modes,
    });
  } catch (error: any) {
    logger.error('Failed to get modes:', error);
    return NextResponse.json(
      { error: 'Failed to get visualizer modes' },
      { status: 500 }
    );
  }
}
