import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as rootGET, POST as rootPOST } from './main';
import { POST as connectPOST } from './connect/route';
import { POST as initPOST } from './init/route';
import { GET as statusGET } from './status/route';
import { GET as storeGET, POST as storePOST, DELETE as storeDELETE } from './store/route';
import { POST as storeSyncPOST } from './store/sync/route';

/**
 * Consolidated mcp route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'status':
      return statusGET();
    case 'store':
      return storeGET(request);
    case 'root':
    default:
      return rootGET(request);
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'connect':
      return connectPOST(request);
    case 'init':
      return initPOST();
    case 'store':
      return storePOST(request);
    case 'store-sync':
      return storeSyncPOST(request);
    case 'root':
    default:
      return rootPOST(request);
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'store':
      return storeDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action for DELETE. Use ?action=store' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}
