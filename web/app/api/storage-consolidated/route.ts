import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as usageGET } from './usage/route';
import { POST as uploadPOST } from './upload/route';
import { POST as signedUrlPOST } from './signed-url/route';
import { GET as listGET } from './list/route';
import { GET as downloadGET } from './download/route';
import { DELETE as deleteDELETE } from './delete/route';

/**
 * Consolidated storage route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'usage':
      return usageGET(request);
    case 'list':
      return listGET(request);
    case 'download':
      return downloadGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=usage|list|download' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'upload':
      return uploadPOST(request);
    case 'signed-url':
      return signedUrlPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=upload|signed-url' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  return deleteDELETE(request);
}