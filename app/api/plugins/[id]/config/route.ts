/**
 * Plugin Config & Execution API
 *
 * PUT /api/plugins/:id/config - Update plugin config
 * POST /api/plugins/:id/execute - Execute plugin with input
 */

import { NextRequest, NextResponse } from 'next/server';
import { updatePluginConfig, executePlugin } from '@/lib/plugins/plugin-system';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Plugins:Config');

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Parse and validate request body
    let body: any;
    try {
      body = await request.json();
    } catch (parseError: any) {
      logger.warn('Invalid JSON in plugin config request', { 
        pluginId: id, 
        error: parseError.message 
      });
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }
    
    const { config } = body;

    // Validate config object (reject arrays)
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return NextResponse.json(
        { error: 'Invalid config format. Config must be an object' },
        { status: 400 }
      );
    }

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
      { error: 'Failed to update plugin config' },
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
    
    // Parse request body with proper error handling
    let body: any;
    try {
      body = await request.json();
    } catch (parseError: any) {
      logger.warn('Invalid JSON in plugin execution request', {
        pluginId: id,
        error: parseError.message
      });
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }
    
    const { input } = body;

    // Validate input object (reject arrays)
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json(
        { error: 'Invalid input format. Input must be an object' },
        { status: 400 }
      );
    }

    const result = await executePlugin(id, input);

    if (!result.success) {
      logger.warn('Plugin execution returned unsuccessful result', {
        pluginId: id,
        error: result.error,
      });
      return NextResponse.json(
        { error: 'Plugin execution failed' },
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
      { error: 'Plugin execution failed' },
      { status: 500 }
    );
  }
}
