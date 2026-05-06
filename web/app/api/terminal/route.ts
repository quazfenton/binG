import { NextRequest } from 'next/server';

// Import all existing handlers
import { POST as inputPOST } from './local-pty/input/gateway';
import { POST as resizePOST } from './local-pty/resize/gateway';
import { GET as ptyGET, POST as ptyPOST } from './local-pty/gateway';

/**
 * Consolidated terminal route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'pty':
      return ptyGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=pty' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'pty':
      return ptyPOST(request);
    case 'input':
      return inputPOST(request);
    case 'resize':
      return resizePOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=pty|input|resize' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}