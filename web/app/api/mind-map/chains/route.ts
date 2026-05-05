/**
 * Mind Map API
 *
 * GET /api/mind-map/chains - List reasoning chains
 * GET /api/mind-map/chains/:id - Get chain details
 * GET /api/mind-map/stats - Get statistics
 */

import { NextRequest, NextResponse } from 'next/server';


import { getReasoningChains, getReasoningChain, getMindMapStats } from '@/lib/mind-map/mind-map-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:MindMap');

// GET - List reasoning chains
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const taskId = searchParams.get('taskId') || undefined;
    
    const chains = await getReasoningChains(taskId);
    
    return NextResponse.json({
      success: true,
      chains,
      count: chains.length,
    });
  } catch (error: any) {
    logger.error('Failed to get reasoning chains:', error);
    return NextResponse.json(
      { error: 'Failed to get reasoning chains' },
      { status: 500 }
    );
  }
}
