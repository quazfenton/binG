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
    const prefix = searchParams.get('prefix') || '';

    const cloudStorage = createCloudStorageService();
    const files = await cloudStorage.list(prefix, userId);
    
    return NextResponse.json({
      success: true,
      data: { files, prefix }
    });
  } catch (error) {
    console.error('Storage list error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to list files' },
      { status: 500 }
    );
  }
}
