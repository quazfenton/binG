/**
 * Installed Plugins API
 *
 * GET /api/plugins/installed - List installed plugins
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstalledPlugins } from '@/lib/plugins/plugin-system';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Plugins:Installed');

export async function GET() {
  try {
    const plugins = await getInstalledPlugins();
    
    return NextResponse.json({
      success: true,
      plugins,
      count: plugins.length,
    });
  } catch (error: any) {
    logger.error('Failed to get installed plugins:', error);
    return NextResponse.json(
      { error: 'Failed to get installed plugins' },
      { status: 500 }
    );
  }
}
