import { NextRequest, NextResponse } from 'next/server';

import { POST as inputPOST } from './local-pty/input/gateway';
import { POST as resizePOST } from './local-pty/resize/gateway';
import { GET as ptyGET, POST as ptyPOST } from './local-pty/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /terminal/pty' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'pty':
      return ptyGET(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /terminal/pty' }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /terminal/pty|/terminal/input|/terminal/resize' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'pty':
      return ptyPOST(request);
    case 'input':
      return inputPOST(request);
    case 'resize':
      return resizePOST(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /terminal/pty|/terminal/input|/terminal/resize' }, { status: 404 });
  }
}