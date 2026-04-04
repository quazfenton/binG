/**
 * Orchestration Statistics API
 *
 * GET /api/orchestration/stats - Get orchestration statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStats } from '@/lib/orchestration/agent-orchestrator';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Orchestration:Stats');

export async function GET() {
  try {
    const stats = await getStats();
    
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
