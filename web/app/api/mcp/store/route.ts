/**
 * MCP Store API
 *
 * Server-side endpoints for MCP server management:
 * - GET /api/mcp/store - List all servers
 * - POST /api/mcp/store/sync - Sync with Smithery
 * - POST /api/mcp/store/install - Install a server
 * - POST /api/mcp/store/uninstall - Uninstall a server
 * - PUT /api/mcp/store/config - Update configuration
 */

import { NextRequest, NextResponse } from 'next/server';


import { auth0 } from '@/lib/auth0';
import { mcpStoreService } from '@/lib/mcp/mcp-store-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:MCP:Store');

// ============================================================================
// GET /api/mcp/store - List all MCP servers
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const source = searchParams.get('source') as any;
    const installed = searchParams.get('installed');

    // Always apply filters, even when query is empty
    const servers = mcpStoreService.searchServers(query, {
      source: source || undefined,
      installed: installed ? installed === 'true' : undefined,
    });

    return NextResponse.json({
      success: true,
      servers,
      stats: mcpStoreService.getStats(),
    });
  } catch (error: any) {
    logger.error('Failed to list MCP servers:', error);
    return NextResponse.json(
      { error: 'Failed to list servers' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/mcp/store/install - Install an MCP server
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { serverId, mcpUrl, apiKeys } = body || {};

    if (!serverId) {
      return NextResponse.json(
        { error: 'Server ID required' },
        { status: 400 }
      );
    }

    const result = await mcpStoreService.installServer(serverId, {
      mcpUrl,
      apiKeys,
    });

    if (!result.success) {
      if (result.reason === 'not_found') {
        return NextResponse.json(
          { error: 'Server not found' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to install server' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Server installed successfully',
    });
  } catch (error: any) {
    logger.error('Failed to install MCP server:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to install server' },
      { status: 500 }
    );
  }
}

// Separate handler for uninstall to avoid method conflict
export async function DELETE(request: NextRequest) {
  try {
    // Auth check
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const serverId = searchParams.get('id');

    if (!serverId) {
      return NextResponse.json(
        { error: 'Server ID required' },
        { status: 400 }
      );
    }

    const result = await mcpStoreService.uninstallServer(serverId);

    if (!result.success) {
      if (result.reason === 'not_found') {
        return NextResponse.json(
          { error: 'Server not found' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to uninstall server' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Server uninstalled successfully',
    });
  } catch (error: any) {
    logger.error('Failed to uninstall MCP server:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to uninstall server' },
      { status: 500 }
    );
  }
}
