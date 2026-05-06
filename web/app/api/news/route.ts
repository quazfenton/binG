/**
 * Consolidated News API
 * 
 * Routes:
 * - GET /api/news?action=feed - Get news feed
 * - POST /api/news?action=clear-cache - Clear feed cache (admin)
 * - GET /api/news?action=rss - Get RSS feeds
 * - POST /api/news?action=rss-parse - Parse RSS feed
 * - GET /api/news?action=image-search - Search images
 * - POST /api/news?action=image-search - Search images
 */

import { NextRequest, NextResponse } from 'next/server';

// Import handlers from existing route files
import { GET as feedGET, POST as feedPOST } from './main';
import { GET as rssGET, POST as rssPOST } from './rss/route';
import { GET as imageSearchGET, POST as imageSearchPOST } from './image-search/route';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'feed';

  switch (action) {
    case 'feed':
      return feedGET(request);
    case 'rss':
      return rssGET(request);
    case 'image-search':
      return imageSearchGET(request);
    default:
      return feedGET(request);
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'clear-cache';

  switch (action) {
    case 'clear-cache':
      return feedPOST(request);
    case 'rss-parse':
      return rssPOST(request);
    case 'image-search':
      return imageSearchPOST(request);
    default:
      return feedPOST(request);
  }
}