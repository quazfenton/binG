import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { getBlaxelMcpService, type BlaxelDeploymentConfig } from '@/lib/mcp/blaxel-mcp-service';

// GET /api/blaxel/mcp - List all MCP servers
export async function GET(request: NextRequest) {
  // SECURITY: Require authentication to prevent unauthorized access to MCP server list
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  const serverId = searchParams.get('serverId');
  const hub = searchParams.get('hub') === 'true';

  const service = getBlaxelMcpService();
  
  if (!service.isConfigured()) {
    return NextResponse.json(
      { error: 'Blaxel API not configured. Set BLAXEL_API_KEY in environment.' },
      { status: 503 }
    );
  }
  
  try {
    // List Blaxel Hub servers
    if (hub) {
      const category = searchParams.get('category') || undefined;
      const servers = await service.listHubServers(category);
      return NextResponse.json({ servers, source: 'hub' });
    }

    // Get specific server
    if (serverId && action === 'get') {
      // Validate serverId format to prevent path traversal
      if (!/^[a-zA-Z0-9_-]+$/.test(serverId)) {
        return NextResponse.json(
          { error: 'Invalid server ID format' },
          { status: 400 }
        );
      }
      const server = await service.getServer(serverId);
      return NextResponse.json({ server });
    }

    // List all deployed servers
    const servers = await service.listServers();
    return NextResponse.json({ servers });
  } catch (error) {
    console.error('[Blaxel MCP] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Blaxel MCP operation failed' },
      { status: 500 }
    );
  }
}

// POST /api/blaxel/mcp - Create or deploy MCP server
export async function POST(request: NextRequest) {
  // SECURITY: Require authentication to prevent unauthorized MCP server deployment
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const service = getBlaxelMcpService();
  
  if (!service.isConfigured()) {
    return NextResponse.json(
      { error: 'Blaxel API not configured. Set BLAXEL_API_KEY in environment.' },
      { status: 503 }
    );
  }
  
  try {
    const body = await request.json();
    const { 
      name, 
      code, 
      source, 
      hubServerId, 
      openApiSpec,
      env, 
      secrets,
      runtime,
      region,
      invoke,
      toolName,
      args 
    } = body;

    // Invoke tool on existing server
    if (invoke && body.serverId) {
      if (!toolName) {
        return NextResponse.json(
          { error: 'toolName is required when invoking a tool' },
          { status: 400 }
        );
      }
      const result = await service.invokeTool(body.serverId, toolName, args);
      return NextResponse.json({ result });
    }

    // Deploy from Hub
    if (source === 'hub' && hubServerId) {
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'name is required for deploying from Hub' },
          { status: 400 }
        );
      }
      const server = await service.deployFromHub(hubServerId, name);
      return NextResponse.json({ server, action: 'deployed' });
    }

    // Deploy from OpenAPI spec
    if (source === 'openapi' && openApiSpec) {
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'name is required for deploying from OpenAPI spec' },
          { status: 400 }
        );
      }
      const server = await service.createFromOpenApi(name, openApiSpec, {
        runtime,
        env,
        secrets
      });
      return NextResponse.json({ server, action: 'deployed' });
    }

    // Deploy custom code
    if (code) {
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'name is required for deploying custom code' },
          { status: 400 }
        );
      }
      const config: BlaxelDeploymentConfig = {
        name,
        code,
        runtime,
        env,
        secrets,
        region,
      };
      const server = await service.createServer(config);
      return NextResponse.json({ server, action: 'deployed' });
    }

    return NextResponse.json(
      { error: 'Invalid deployment configuration. Provide code, openApiSpec, or hubServerId.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Blaxel MCP] Deployment error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to deploy MCP server' },
      { status: 500 }
    );
  }
}

// PATCH /api/blaxel/mcp - Update server configuration
export async function PATCH(request: NextRequest) {
  // SECURITY: Require authentication to prevent unauthorized MCP server modification
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const serverId = searchParams.get('serverId');

  if (!serverId) {
    return NextResponse.json(
      { error: 'Server ID is required' },
      { status: 400 }
    );
  }

  const service = getBlaxelMcpService();
  
  if (!service.isConfigured()) {
    return NextResponse.json(
      { error: 'Blaxel API not configured. Set BLAXEL_API_KEY in environment.' },
      { status: 503 }
    );
  }
  
  try {
    const body = await request.json();
    const { name, env, secrets, timeout } = body;

    const server = await service.updateServer(serverId, {
      name,
      env,
      secrets,
      timeout,
    });

    return NextResponse.json({ server });
  } catch (error) {
    console.error('[Blaxel MCP] Update error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update MCP server' },
      { status: 500 }
    );
  }
}

// DELETE /api/blaxel/mcp - Delete MCP server
export async function DELETE(request: NextRequest) {
  // SECURITY: Require authentication to prevent unauthorized MCP server deletion
  const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const serverId = searchParams.get('serverId');

  if (!serverId) {
    return NextResponse.json(
      { error: 'Server ID is required' },
      { status: 400 }
    );
  }

  const service = getBlaxelMcpService();
  
  if (!service.isConfigured()) {
    return NextResponse.json(
      { error: 'Blaxel API not configured. Set BLAXEL_API_KEY in environment.' },
      { status: 503 }
    );
  }
  
  try {
    await service.deleteServer(serverId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Blaxel MCP] Delete error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete MCP server' },
      { status: 500 }
    );
  }
}
