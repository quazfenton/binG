import { NextRequest, NextResponse } from 'next/server';
import { POST as inputPOST } from './local-pty/input/gateway';
import { POST as resizePOST } from './local-pty/resize/gateway';
import { GET as ptyGET, POST as ptyPOST } from './local-pty/gateway';

/**
 * Consolidated terminal route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3 && segments[2] === 'pty') return ptyGET(request);
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3 && segments[2] === 'pty') return ptyPOST(request);
  if (segments.length === 4 && segments[2] === 'pty' && segments[3] === 'input') return inputPOST(request);
  if (segments.length === 4 && segments[2] === 'pty' && segments[3] === 'resize') return resizePOST(request);
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}