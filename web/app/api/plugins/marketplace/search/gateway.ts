/**
 * Plugin Search API
 *
 * GET /api/plugins/marketplace/search?q=query&category=ai
 */

import { NextRequest, NextResponse } from 'next/server';


import { searchPlugins, type PluginCategory } from '@/lib/plugins/plugin-system';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Plugins:Search');

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const category = searchParams.get('category') as PluginCategory | undefined;
    
    const plugins = await searchPlugins(query, category);
    
    return NextResponse.json({
      success: true,
      plugins,
      count: plugins.length,
      query,
    });
  } catch (error: any) {
    logger.error('Failed to search plugins:', error);
    return NextResponse.json(
      { error: 'Failed to search plugins' },
      { status: 500 }
    );
  }
}
