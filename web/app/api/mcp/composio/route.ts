/**
 * GET /api/mcp/composio — Composio MCP Server Status
 * POST /api/mcp/composio — Create Composio MCP Session
 *
 * Exposes the Composio MCP server for session management and status checks.
 * The MCP server itself runs on a separate port (COMPOSIO_MCP_PORT, default 3001)
 * but this API route provides a management interface via the Next.js API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth/auth0';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:MCP:Composio');

/**
 * GET — Return Composio MCP server info
 */
export async function GET(_request: NextRequest) {
  try {
    const composioApiKey = process.env.COMPOSIO_API_KEY;
    if (!composioApiKey) {
      return NextResponse.json(
        { status: 'disabled', reason: 'COMPOSIO_API_KEY not configured' },
        { status: 200 }
      );
    }

    const mcpPort = parseInt(process.env.COMPOSIO_MCP_PORT || '3001', 10);

    // Get server info from global reference if started
    const mcpServer = (globalThis as any).__composioMcpServer;
    const serverInfo = mcpServer?.getServerInfo?.() || null;

    return NextResponse.json({
      status: serverInfo ? 'running' : 'starting',
      name: 'composio-tools',
      version: '1.0.0',
      port: mcpPort,
      mcpEndpoint: `http://localhost:${mcpPort}/mcp`,
      sessions: serverInfo?.sessions || 0,
      configured: true,
    });
  } catch (error: any) {
    logger.error('Failed to get Composio MCP status:', error);
    return NextResponse.json(
      { error: 'Failed to get Composio MCP status' },
      { status: 500 }
    );
  }
}

/**
 * POST — Create a new MCP session for a user
 *
 * Requires authentication. Body: (empty — userId derived from session)
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check — require authenticated user
    const session = await auth0.getSession(request);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = session.user.sub || session.user.email;
    if (!userId) {
      return NextResponse.json(
        { error: 'Unable to identify user' },
        { status: 400 }
      );
    }

    const composioApiKey = process.env.COMPOSIO_API_KEY;
    if (!composioApiKey) {
      return NextResponse.json(
        { error: 'Composio MCP is not configured' },
        { status: 503 }
      );
    }

    // Use the global MCP server instance if available, otherwise fall back
    const mcpServer = (globalThis as any).__composioMcpServer;

    if (mcpServer && typeof mcpServer.createSession === 'function') {
      // Use running MCP server's session management (shares state with the server)
      const mcpSession = await mcpServer.createSession(userId);
      return NextResponse.json({
        success: true,
        session: {
          id: mcpSession.id,
          url: mcpSession.mcp?.url || `http://localhost:${parseInt(process.env.COMPOSIO_MCP_PORT || '3001', 10)}/mcp`,
          toolCount: mcpSession.tools?.length || 0,
        },
      });
    }

    // Fallback: standalone session (MCP server not yet started)
    const { getComposioMCPSession } = await import(
      '@/lib/integrations/composio-mcp-service'
    );

    const standaloneSession = await getComposioMCPSession(userId, composioApiKey);

    if (!standaloneSession) {
      return NextResponse.json(
        { error: 'Failed to create MCP session' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      session: {
        url: standaloneSession.url,
        headers: standaloneSession.headers,
        toolCount: standaloneSession.tools?.length || 0,
      },
    });
  } catch (error: any) {
    logger.error('Failed to create Composio MCP session:', error);
    return NextResponse.json(
      { error: 'Failed to create MCP session' },
      { status: 500 }
    );
  }
}
