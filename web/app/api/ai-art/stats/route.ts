/**
 * AI Art Statistics API
 *
 * GET /api/ai-art/stats - Get gallery statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGalleryStats } from '@/lib/ai-art/ai-art-gallery';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AIArt:Stats');

export async function GET() {
  try {
    const stats = await getGalleryStats();

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
