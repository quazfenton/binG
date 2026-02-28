import { NextRequest, NextResponse } from 'next/server';
import { getSmitheryService, type SmitheryServer } from '@/lib/mcp/smithery-service';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';
  const limit = parseInt(searchParams.get('limit') || '20');
  const offset = parseInt(searchParams.get('offset') || '0');
  const verified = searchParams.get('verified') === 'true';
  const deploymentStatus = searchParams.get('deploymentStatus') as 
    | 'hosted' 
    | 'external' 
    | 'stdio' 
    | 'repo' 
    | null;

  const service = getSmitheryService();
  
  if (!service.isConfigured()) {
    return NextResponse.json(
      { error: 'Smithery API not configured. Set SMITHERY_API_KEY in environment.' },
      { status: 503 }
    );
  }
  
  try {
    const servers = await service.searchServers(query, {
      limit,
      offset,
      verified: verified || undefined,
      deploymentStatus: deploymentStatus || undefined,
    });
    
    return NextResponse.json({ servers });
  } catch (error) {
    console.error('[Smithery] Search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search servers' },
      { status: 500 }
    );
  }
}
