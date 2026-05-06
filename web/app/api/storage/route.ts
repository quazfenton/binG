import { NextRequest, NextResponse } from 'next/server';
import { GET as usageGET } from './usage/gateway';
import { POST as uploadPOST } from './upload/gateway';
import { GET as signedUrlGET } from './signed-url/gateway';
import { GET as listGET } from './list/gateway';
import { GET as downloadGET } from './download/gateway';
import { DELETE as deleteDELETE } from './delete/gateway';

/**
 * Consolidated storage route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3) {
    switch (segments[2]) {
      case 'usage': return usageGET(request);
      case 'signed-url': return signedUrlGET(request);
      case 'list': return listGET(request);
      case 'download': return downloadGET(request);
    }
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3 && segments[2] === 'upload') return uploadPOST(request);
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function DELETE(request: NextRequest) {
  return deleteDELETE(request);
}