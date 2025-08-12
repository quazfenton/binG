import { NextRequest, NextResponse } from 'next/server';
import { createCloudStorageService } from '@/lib/services/cloud-storage';
import { verifyAuth } from '@/lib/auth/jwt';

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await verifyAuth(request);
    if (!authResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authResult.userId!;
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');

    if (!path) {
      return NextResponse.json(
        { error: 'Path parameter is required' },
        { status: 400 }
      );
    }

    const cloudStorage = createCloudStorageService();
    const blob = await cloudStorage.download(path, userId);
    
    return new NextResponse(blob, {
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${path.split('/').pop()}"`,
      },
    });
  } catch (error) {
    console.error('Storage download error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to download file' },
      { status: 500 }
    );
  }
}
