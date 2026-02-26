import { NextRequest, NextResponse } from 'next/server';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const owner = await resolveFilesystemOwner(req);
    const body = await req.json();
    const filePath = typeof body?.path === 'string' ? body.path : '';

    if (!filePath.trim()) {
      return NextResponse.json(
        { success: false, error: 'path is required' },
        { status: 400 },
      );
    }

    const file = await virtualFilesystem.readFile(owner.ownerId, filePath);
    return NextResponse.json({
      success: true,
      data: file,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to read file';
    const status = message.toLowerCase().includes('not found') ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
