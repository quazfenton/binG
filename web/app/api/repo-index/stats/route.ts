/**
 * Repo Index Stats API
 *
 * GET /api/repo-index/stats - Get index statistics
 */

import { NextRequest, NextResponse } from 'next/server';


import { repoIndexer } from '@/lib/repo-index/indexer';

/**
 * GET /api/repo-index/stats
 *
 * Get index statistics
 */
export async function GET() {
  try {
    const stats = repoIndexer.getIndexStats();

    return NextResponse.json({
      success: true,
      stats,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RepoIndex] GET /api/repo-index/stats failed', { message });
    return NextResponse.json({
      error: 'Failed to get stats',
    }, { status: 500 });
  }
}
