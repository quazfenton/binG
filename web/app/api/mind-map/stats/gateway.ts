/**
 * Mind Map Statistics API
 *
 * GET /api/mind-map/stats - Get mind map statistics
 */

import { NextRequest, NextResponse } from 'next/server';


import { getMindMapStats } from '@/lib/mind-map/mind-map-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:MindMap:Stats');

export async function GET() {
  try {
    const stats = await getMindMapStats();
    
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
