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

    const userId = authResult.userId;
    const cloudStorage = createCloudStorageService();
    
    const usage = await cloudStorage.getUsage(userId);
    
    return NextResponse.json({
      success: true,
      data: usage
    });
  } catch (error) {
    console.error('Storage usage error:', error);
    return NextResponse.json(
      { error: 'Failed to get storage usage' },
      { status: 500 }
    );
  }
}
