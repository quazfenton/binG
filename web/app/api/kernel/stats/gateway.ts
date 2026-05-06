/**
 * Kernel Stats API
 * 
 * Exposes Agent Kernel statistics to the orchestration UI.
 * GET /api/kernel/stats
 */

import { NextResponse } from 'next/server';


import { getAgentKernel } from '@bing/shared/agent';

export async function GET() {
  try {
    const kernel = getAgentKernel();
    const stats = kernel.getStats();
    
    return NextResponse.json(stats, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: any) {
    console.error('[API.kernel.stats] Error:', error.message);
    return NextResponse.json(
      { error: 'Failed to get kernel stats', details: error.message },
      { status: 500 }
    );
  }
}
