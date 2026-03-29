/**
 * Observability Status API
 * 
 * GET /api/observability/status - Observability status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getObservabilityStatus } from '@/lib/observability';

/**
 * GET /api/observability/status
 * 
 * Returns observability system status
 */
export async function GET(request: NextRequest) {
  try {
    const status = getObservabilityStatus();
    
    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error: any) {
    // Log detailed error server-side, return generic message to client
    console.error('[Observability] Failed to get status:', error);
    return NextResponse.json({
      error: 'Failed to get status',
    }, { status: 500 });
  }
}