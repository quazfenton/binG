/**
 * Music Data API
 * Consolidated route — dispatches to sub-handler route.ts files.
 *
 * Endpoints:
 * - GET /api/music - Get tracks (main.ts)
 * - GET /api/music/visualizer/modes - Get visualizer modes (visualizer/modes/route.ts)
 * - GET /api/music/visualizer/stats - Get visualizer stats (visualizer/stats/route.ts)
 * - GET /api/music/visualizer/tracks - Get tracks for visualizer (visualizer/tracks/route.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET } from './main';
import { GET as modesGET } from './visualizer/modes/gateway';
import { GET as statsGET } from './visualizer/stats/gateway';
import { GET as tracksGET } from './visualizer/tracks/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/music/visualizer/modes -> modes route
  if (path.endsWith('/visualizer/modes')) {
    return modesGET(request);
  }

  // /api/music/visualizer/stats -> stats route
  if (path.endsWith('/visualizer/stats')) {
    return statsGET(request);
  }

  // /api/music/visualizer/tracks -> tracks route
  if (path.endsWith('/visualizer/tracks')) {
    return tracksGET(request);
  }

  // /api/music -> main handler
  return rootGET(request);
}