/**
 * Zine Display API
 *
 * GET /api/zine-display/content - Get content items
 * GET /api/zine-display/content/:id - Get content by ID
 * POST /api/zine-display/content/:id/read - Mark as read
 * POST /api/zine-display/content/:id/star - Star content
 * GET /api/zine-display/stats - Get statistics
 * GET /api/zine-display/search - Search content
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getContent,
  getContentById,
  markAsRead,
  starContent,
  getZineStats,
  searchContent,
  type ContentSource,
} from '@/lib/zine/zine-display-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:ZineDisplay');

// GET - List content items
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');
    const source = searchParams.get('source') as ContentSource | undefined;

    const content = await getContent(limit, source);

    return NextResponse.json({
      success: true,
      content,
      count: content.length,
    });
  } catch (error: any) {
    logger.error('Failed to get content:', error);
    return NextResponse.json(
      { error: 'Failed to get content' },
      { status: 500 }
    );
  }
}
