import { NextRequest, NextResponse } from 'next/server';
import { GET as callbackGET, POST as callbackPOST } from './callback/gateway';
import { GET as mcpGET, POST as mcpPOST, PATCH as mcpPATCH, DELETE as mcpDELETE } from './mcp/gateway';

/**
 * Consolidated blaxel route
 * Preserved original at ./main.ts
 */
export async function GET(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/blaxel/callback
  if (pathParts.includes('callback')) {
    return callbackGET();
  }

  // /api/blaxel/mcp - List MCP servers
  return mcpGET(request);
}

export async function POST(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/blaxel/callback
  if (pathParts.includes('callback')) {
    return callbackPOST(request);
  }

  // /api/blaxel/mcp - Deploy MCP server
  return mcpPOST(request);
}

export async function PATCH(request: NextRequest) {
  // /api/blaxel/mcp - Update server config
  return mcpPATCH(request);
}

export async function DELETE(request: NextRequest) {
  // /api/blaxel/mcp - Delete MCP server
  return mcpDELETE(request);
}