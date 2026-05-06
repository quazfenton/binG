import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as usageGET } from './usage/route';
import { POST as uploadPOST } from './upload/route';
import { GET as signedUrlGET } from './signed-url/route';
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
    case 'signed-url':
      return signedUrlGET(request);
    case 'list':
      return listGET(request);
    case 'download':
      return downloadGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=usage|signed-url|list|download' }),
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
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=upload' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  return deleteDELETE(request);
}