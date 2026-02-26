import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const owner = await resolveFilesystemOwner(req);
    const body = await req.json();
    const targetPath = typeof body?.path === 'string' ? body.path : '';

    if (!targetPath.trim()) {
      return NextResponse.json(
        { success: false, error: 'path is required' },
        { status: 400 },
      );
    }

    const result = await virtualFilesystem.deletePath(owner.ownerId, targetPath);
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete path';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
