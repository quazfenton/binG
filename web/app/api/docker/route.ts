import { NextRequest } from 'next/server';

// Import all existing handlers
import { POST as composePOST } from './compose/route';
import { GET as containersGET } from './containers/route';
import { POST as execPOST } from './exec/route';
import { DELETE as removeDELETE } from './remove/[id]/route';
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
    case 'start': {
      const id = searchParams.get('id');
      if (!id) {
        return new Response(
          JSON.stringify({ error: 'id query parameter is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return startPOST(request, { params: Promise.resolve({ id }) });
    }
    case 'stop': {
      const id = searchParams.get('id');
      if (!id) {
        return new Response(
          JSON.stringify({ error: 'id query parameter is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return stopPOST(request, { params: Promise.resolve({ id }) });
    }
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=compose|exec|start|stop' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'remove': {
      const id = searchParams.get('id');
      if (!id) {
        return new Response(
          JSON.stringify({ error: 'id query parameter is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return removeDELETE(request, { params: Promise.resolve({ id }) });
    }
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=remove' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}