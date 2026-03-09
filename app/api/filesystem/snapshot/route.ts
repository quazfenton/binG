import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const owner = await resolveFilesystemOwner(req);
    const url = new URL(req.url);
    const pathFilter = (url.searchParams.get('path') || 'project').replace(/\/+$/, '');
    const snapshot = await virtualFilesystem.exportWorkspace(owner.ownerId);
    const prefix = `${pathFilter}/`;
    const files = snapshot.files.filter(
      (file) => file.path === pathFilter || file.path.startsWith(prefix),
    );

    return NextResponse.json({
      success: true,
      data: {
        root: snapshot.root,
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        path: pathFilter,
        files,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to export workspace snapshot';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
