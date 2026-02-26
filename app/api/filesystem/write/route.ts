import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const owner = await resolveFilesystemOwner(req);
    const body = await req.json();
    const filePath = typeof body?.path === 'string' ? body.path : '';
    const content = typeof body?.content === 'string' ? body.content : '';

    if (!filePath.trim()) {
      return NextResponse.json(
        { success: false, error: 'path is required' },
        { status: 400 },
      );
    }

    const file = await virtualFilesystem.writeFile(owner.ownerId, filePath, content);
    return NextResponse.json({
      success: true,
      data: {
        path: file.path,
        version: file.version,
        language: file.language,
        size: file.size,
        lastModified: file.lastModified,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to write file';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
