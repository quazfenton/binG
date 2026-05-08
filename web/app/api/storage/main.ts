import { NextRequest, NextResponse } from 'next/server';

import { GET as usageGET } from './usage/gateway';
import { POST as uploadPOST } from './upload/gateway';
import { GET as signedUrlGET } from './signed-url/gateway';
import { GET as listGET } from './list/gateway';
import { GET as downloadGET } from './download/gateway';
import { DELETE as deleteDELETE } from './delete/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /storage/usage|/storage/signed-url|/storage/list|/storage/download' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'usage':
      return usageGET(request);
    case 'signed-url':
      return signedUrlGET(request);
    case 'list':
      return listGET(request);
    case 'download':
      return downloadGET(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /storage/usage|/storage/signed-url|/storage/list|/storage/download' }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /storage/upload' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'upload':
      return uploadPOST(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /storage/upload' }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  return deleteDELETE(request);
}