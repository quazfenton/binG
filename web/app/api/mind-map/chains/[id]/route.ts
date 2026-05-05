/**
 * Reasoning Chain Details API
 *
 * GET /api/mind-map/chains/:id - Get chain details
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getReasoningChain } from '@/lib/mind-map/mind-map-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:MindMap:Chain');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const chain = await getReasoningChain(id);
    
    if (!chain) {
      return NextResponse.json(
        { error: 'Chain not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      chain,
    });
  } catch (error: any) {
    logger.error('Failed to get chain:', error);
    return NextResponse.json(
      { error: 'Failed to get chain details' },
      { status: 500 }
    );
  }
}
