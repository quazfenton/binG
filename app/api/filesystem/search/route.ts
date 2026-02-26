import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const owner = await resolveFilesystemOwner(req);
    const url = new URL(req.url);
    const query = url.searchParams.get('q') || '';
    const path = url.searchParams.get('path') || 'project';
    const limitRaw = Number.parseInt(url.searchParams.get('limit') || '', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

    if (!query.trim()) {
      return NextResponse.json({
        success: true,
        data: {
          query: '',
          results: [],
        },
      });
    }

    const results = await virtualFilesystem.search(owner.ownerId, query, { path, limit });
    return NextResponse.json({
      success: true,
      data: {
        query,
        path,
        results,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Search failed';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
