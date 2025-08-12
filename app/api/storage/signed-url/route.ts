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
    const expiresIn = parseInt(searchParams.get('expiresIn') || '3600');

    if (!path) {
      return NextResponse.json(
        { error: 'Path parameter is required' },
        { status: 400 }
      );
    }

    const cloudStorage = createCloudStorageService();
    const signedUrl = await cloudStorage.getSignedUrl(path, expiresIn, userId);
    
    return NextResponse.json({
      success: true,
      data: { signedUrl, expiresIn, path }
    });
  } catch (error) {
    console.error('Storage signed URL error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to generate signed URL' },
      { status: 500 }
    );
  }
}
