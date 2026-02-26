import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const owner = await resolveFilesystemOwner(req);
    const url = new URL(req.url);
    const dirPath = url.searchParams.get('path') || 'project';
    const listing = await virtualFilesystem.listDirectory(owner.ownerId, dirPath);

    return NextResponse.json({
      success: true,
      data: {
        path: listing.path,
        nodes: listing.nodes,
        ownerSource: owner.source,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list directory';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
  }
}
