/**
 * Zine Statistics API
 *
 * GET /api/zine-display/stats - Get zine statistics
 */

import { NextRequest, NextResponse } from 'next/server';


import { getZineStats } from '@/lib/zine/zine-display-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:ZineDisplay:Stats');

export async function GET() {
  try {
    const stats = await getZineStats();

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
