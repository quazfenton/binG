/**
 * Plugin Management API
 *
 * POST /api/plugins/:id/install - Install plugin
 * POST /api/plugins/:id/uninstall - Uninstall plugin
 * POST /api/plugins/:id/enable - Enable plugin
 * POST /api/plugins/:id/disable - Disable plugin
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import {
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
} from '@/lib/plugins/plugin-system';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Plugins:Manage');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  try {
    const { id, action } = await params;
    let success: boolean;

    switch (action) {
      case 'install':
        success = await installPlugin(id);
        logger.info('Plugin installed:', { pluginId: id });
        break;
      
      case 'uninstall':
        success = await uninstallPlugin(id);
        logger.info('Plugin uninstalled:', { pluginId: id });
        break;
      
      case 'enable':
        success = await enablePlugin(id);
        logger.info('Plugin enabled:', { pluginId: id });
        break;
      
      case 'disable':
        success = await disablePlugin(id);
        logger.info('Plugin disabled:', { pluginId: id });
        break;
      
      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}` },
          { status: 400 }
        );
    }

    if (!success) {
      return NextResponse.json(
        { error: `Failed to ${action} plugin` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      action,
      pluginId: id,
    });
  } catch (error: any) {
    logger.error('Plugin management failed:', error);
    return NextResponse.json(
      { error: error.message || 'Plugin management failed' },
      { status: 500 }
    );
  }
}
