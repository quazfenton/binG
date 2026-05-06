/**
 * Orchestration Statistics API
 *
 * GET /api/orchestration/stats - Get orchestration statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { getAgentKernel } from '@bing/shared/agent/agent-kernel';

const logger = createLogger('API:Orchestration:Stats');

export async function GET() {
  try {
    const kernel = getAgentKernel();
    const stats = kernel.getStats();

    return NextResponse.json({
      success: true,
      stats,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    logger.error('Failed to get stats:', error);
    return NextResponse.json(
      { error: 'Failed to get statistics' },
      { status: 500 }
    );
  }
}
