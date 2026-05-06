import { NextRequest, NextResponse } from 'next/server';
import { GET as connectionsGET, POST as connectionsPOST, DELETE as connectionsDELETE } from './connections/gateway';
import { GET as serversGET } from './servers/gateway';

/**
 * Consolidated smithery route
 * Preserved original at ./main.ts
 */
export async function GET(request: NextRequest) {
  const pathParts = request.nextUrl.pathname.split('/').filter(Boolean);

  // /api/smithery/connections
  if (pathParts.includes('connections')) {
    return connectionsGET(request);
  }

  // /api/smithery/servers
  return serversGET(request);
}

export async function POST(request: NextRequest) {
  // /api/smithery/connections - Create/update connection
  return connectionsPOST(request);
}

export async function DELETE(request: NextRequest) {
  // /api/smithery/connections - Delete connection
  return connectionsDELETE(request);
}