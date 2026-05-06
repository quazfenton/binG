/**
 * Custom Test Endpoint: Read file from VFS
 * 
 * GET /api/test/vfs-read-file?path=project/sessions/001/filename.txt&ownerId=user123
 * Returns: file content or error
 */

import { NextRequest, NextResponse } from 'next/server';



export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const filePath = url.searchParams.get('path');
    const ownerId = url.searchParams.get('ownerId');

    if (!filePath || !ownerId) {
      return NextResponse.json({ error: 'path and ownerId required' }, { status: 400 });
    }

    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
    const content = await virtualFilesystem.readFile(ownerId, filePath);

    return NextResponse.json({
      path: filePath,
      exists: true,
      content,
    });
  } catch (error: any) {
    if (error.message?.includes('not found') || error.message?.includes('No such file')) {
      return NextResponse.json({ exists: false, error: error.message });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
