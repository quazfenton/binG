/**
 * Plugin Marketplace API
 *
 * GET /api/plugins/marketplace - List marketplace plugins
 * GET /api/plugins/marketplace/search - Search plugins
 * GET /api/plugins/installed - List installed plugins
 * POST /api/plugins/:id/install - Install plugin
 * POST /api/plugins/:id/uninstall - Uninstall plugin
 * POST /api/plugins/:id/enable - Enable plugin
 * POST /api/plugins/:id/disable - Disable plugin
 * PUT /api/plugins/:id/config - Update plugin config
 * POST /api/plugins/:id/execute - Execute plugin
 */

import { NextRequest, NextResponse } from 'next/server';


import {
  getMarketplacePlugins,
  getInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  updatePluginConfig,
  executePlugin,
  searchPlugins,
  type PluginCategory,
} from '@/lib/plugins/plugin-system';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Plugins');

// GET - List marketplace plugins
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category') as PluginCategory | undefined;
    
    const plugins = await getMarketplacePlugins(category);
    
    return NextResponse.json({
      success: true,
      plugins,
      count: plugins.length,
    });
  } catch (error: any) {
    logger.error('Failed to get marketplace plugins:', error);
    return NextResponse.json(
      { error: 'Failed to get marketplace plugins' },
      { status: 500 }
    );
  }
}
