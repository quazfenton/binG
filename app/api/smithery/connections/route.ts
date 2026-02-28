import { NextRequest, NextResponse } from 'next/server';
import { getSmitheryService } from '@/lib/mcp/smithery-service';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const namespace = searchParams.get('namespace') || undefined;

  const service = getSmitheryService();
  
  if (!service.isConfigured()) {
    return NextResponse.json(
      { error: 'Smithery API not configured. Set SMITHERY_API_KEY in environment.' },
      { status: 503 }
    );
  }
  
  try {
    const connections = await service.listConnections(namespace);
    return NextResponse.json({ connections });
  } catch (error) {
    console.error('[Smithery] List connections error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list connections' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const service = getSmitheryService();
  
  if (!service.isConfigured()) {
    return NextResponse.json(
      { error: 'Smithery API not configured. Set SMITHERY_API_KEY in environment.' },
      { status: 503 }
    );
  }
  
  try {
    const body = await request.json();
    const { mcpUrl, metadata, connectionId } = body;

    if (connectionId) {
      // Update existing connection
      const connection = await service.createOrUpdateConnection(connectionId, mcpUrl);
      return NextResponse.json({ connection });
    } else if (mcpUrl) {
      // Create new connection
      const connection = await service.createConnection(mcpUrl, metadata);
      return NextResponse.json({ connection });
    } else {
      return NextResponse.json(
        { error: 'Either mcpUrl or connectionId is required' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[Smithery] Connection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to manage connection' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const connectionId = searchParams.get('id');

  if (!connectionId) {
    return NextResponse.json(
      { error: 'Connection ID is required' },
      { status: 400 }
    );
  }

  const service = getSmitheryService();
  
  if (!service.isConfigured()) {
    return NextResponse.json(
      { error: 'Smithery API not configured. Set SMITHERY_API_KEY in environment.' },
      { status: 503 }
    );
  }
  
  try {
    await service.deleteConnection(connectionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Smithery] Delete connection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete connection' },
      { status: 500 }
    );
  }
}
