/**
 * POST /api/mcp/store/sync - Sync with Smithery
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { auth0 } from '@/lib/auth0';
import { mcpStoreService } from '@/lib/mcp/mcp-store-service';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:MCP:Store:Sync');

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

    // Parse body gracefully - allow empty body for full sync
    let body: { query?: string; limit?: number; verified?: boolean } = {};
    try {
      const raw = await request.text();
      if (raw && raw.trim()) {
        body = JSON.parse(raw);
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { query, limit, verified } = body;

    const servers = await mcpStoreService.syncWithSmithery({
      query,
      limit,
      verified,
    });

    return NextResponse.json({
      success: true,
      servers,
      count: servers.length,
    });
  } catch (error: any) {
    logger.error('Failed to sync with Smithery:', error);
    return NextResponse.json(
      { error: 'Failed to sync with Smithery' },
      { status: 500 }
    );
  }
}
