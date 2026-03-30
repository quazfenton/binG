/**
 * Plugin Config & Execution API
 *
 * PUT /api/plugins/:id/config - Update plugin config
 * POST /api/plugins/:id/execute - Execute plugin
 */

import { NextRequest, NextResponse } from 'next/server';
import { updatePluginConfig, executePlugin } from '@/lib/plugins/plugin-system';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Plugins:Execute');

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { config } = body;

    const success = await updatePluginConfig(id, config);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update plugin config' },
        { status: 500 }
      );
    }

    logger.info('Plugin config updated:', { pluginId: id });

    return NextResponse.json({
      success: true,
      pluginId: id,
    });
  } catch (error: any) {
    logger.error('Failed to update plugin config:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update plugin config' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { input } = body;

    const result = await executePlugin(id, input);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Plugin execution failed' },
        { status: 500 }
      );
    }

    logger.info('Plugin executed:', { pluginId: id, executionTime: result.executionTime });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    logger.error('Plugin execution failed:', error);
    return NextResponse.json(
      { error: error.message || 'Plugin execution failed' },
      { status: 500 }
    );
  }
}
