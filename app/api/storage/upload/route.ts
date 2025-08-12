import { NextRequest, NextResponse } from 'next/server';
import { createCloudStorageService } from '@/lib/services/cloud-storage';
import { verifyAuth } from '@/lib/auth/jwt';

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await verifyAuth(request);
    if (!authResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = authResult.userId!;
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const path = formData.get('path') as string;

    if (!file || !path) {
      return NextResponse.json(
        { error: 'File and path are required' },
        { status: 400 }
      );
    }

    const cloudStorage = createCloudStorageService();
    const url = await cloudStorage.upload(file, path, userId);
    
    return NextResponse.json({
      success: true,
      data: { url, path, size: file.size }
    });
  } catch (error) {
    console.error('Storage upload error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to upload file' },
      { status: 500 }
    );
  }
}
