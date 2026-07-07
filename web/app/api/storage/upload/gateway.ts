import { NextRequest, NextResponse } from 'next/server';


import { createCloudStorageService } from '@/lib/storage/cloud-storage';
import { verifyAuth } from '@/lib/auth/jwt';
import type { StorageResponse, UploadData } from '@/lib/types/storage';
import { createSuccessResponse, createErrorResponse, toStorageError } from '@/lib/types/storage';

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  
  try {
    // Sequence check: verify auth BEFORE request.formData(). This route has NO
    // CSRF protection, NO per-IP rate-limit at the gateway (no /api/storage/* entry
    // in vercel.json), and accepts an attacker-controllable request body. The
    // audit-clean NEW-1 followup-b mirror would Promise.all([verifyAuth(request),
    // request.formData()]) — but that fires formData() BEFORE auth-check completes,
    // amplifying every failed-auth request into a full multipart parse+discard.
    // That's a body-consumption DoS vector on an unprotected route. Sequential
    // auth-then-parse is the correct ordering for THIS SPECIFIC route. Documented
    // exception in /opt/bing/docs/async-parallelization-opportunities.md §NEW-1
    // followup-b (Group B).
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
