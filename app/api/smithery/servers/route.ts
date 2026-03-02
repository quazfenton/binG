import { NextRequest, NextResponse } from 'next/server';
import { getSmitheryService, type SmitheryServer } from '@/lib/mcp/smithery-service';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';
  
  // Validate and clamp limit/offset to prevent invalid values and unbounded page sizes
  const limitParam = parseInt(searchParams.get('limit') || '20', 10);
  const offsetParam = parseInt(searchParams.get('offset') || '0', 10);
  const limit = Number.isNaN(limitParam) ? 20 : Math.max(1, Math.min(100, limitParam));
  const offset = Number.isNaN(offsetParam) ? 0 : Math.max(0, offsetParam);
  
  const verifiedParam = searchParams.get('verified');
  // Preserve explicit verified=false instead of converting to undefined
  const verified = verifiedParam === 'true' ? true : (verifiedParam === 'false' ? false : undefined);
  
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
      verified,
      deploymentStatus: deploymentStatus || undefined,
    });

    return NextResponse.json({ servers });
  } catch (error) {
    console.error('[Smithery] Search error:', error);
    return NextResponse.json(
      { error: 'Failed to search servers' },
      { status: 500 }
    );
  }
}
