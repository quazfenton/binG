import { NextRequest } from 'next/server';

// Import all existing handlers
import { POST as composePOST } from './compose/route';
import { GET as containersGET } from './containers/route';
import { POST as execPOST } from './exec/route';
import { POST as removePOST } from './remove/[id]/route';
import { POST as startPOST } from './start/[id]/route';
import { POST as stopPOST } from './stop/[id]/route';

/**
 * Consolidated docker route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'containers':
      return containersGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=containers' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'compose':
      return composePOST(request);
    case 'exec':
      return execPOST(request);
    case 'remove':
      return removePOST(request);
    case 'start':
      return startPOST(request);
    case 'stop':
      return stopPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=compose|exec|remove|start|stop' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}