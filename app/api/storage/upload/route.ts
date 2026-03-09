import { NextRequest, NextResponse } from 'next/server';
import { createCloudStorageService } from '@/lib/services/cloud-storage';
import { verifyAuth } from '@/lib/auth/jwt';
import type { StorageResponse, UploadData } from '@/lib/types/storage';
import { createSuccessResponse, createErrorResponse, toStorageError } from '@/lib/types/storage';

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  
  try {
    // Verify authentication
    const authResult = await verifyAuth(request);
    if (!authResult.success) {
      return NextResponse.json<StorageResponse<never>>(
        createErrorResponse({
          code: 'STORAGE_UNAUTHORIZED',
          message: 'Authentication required',
        }),
        { status: 401 }
      );
    }

    const userId = authResult.userId!;
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const path = formData.get('path') as string;

    if (!file || !path) {
      return NextResponse.json<StorageResponse<never>>(
        createErrorResponse({
          code: 'STORAGE_INVALID_PARAMETERS',
          message: 'File and path are required',
        }),
        { status: 400 }
      );
    }

    const cloudStorage = createCloudStorageService();
    const url = await cloudStorage.upload(file, path, userId);

    const data: UploadData = {
      url,
      key: path,
      path,
      size: file.size,
      contentType: file.type,
      uploadedAt: new Date().toISOString(),
    };

    return NextResponse.json<StorageResponse<UploadData>>(
      createSuccessResponse(data, { userId, requestId })
    );
  } catch (error) {
    console.error('Storage upload error:', error);
    const storageError = toStorageError(error);
    
    return NextResponse.json<StorageResponse<never>>(
      createErrorResponse(storageError, { requestId }),
      { status: storageError.code === 'STORAGE_QUOTA_EXCEEDED' ? 413 : 500 }
    );
  }
}
