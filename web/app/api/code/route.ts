import { NextRequest, NextResponse } from 'next/server';

import { POST as executePOST, GET as templatesGET } from './execute/gateway';
import { GET as snippetsGET, POST as snippetsPOST } from './snippets/gateway';

// GET /api/code/templates | /api/code/snippets
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && (segments[2] === 'templates' || segments[2] === 'snippet')) {
    return snippetsGET(request);
  }

  // default → templates
  return templatesGET(request);
}

// POST /api/code/execute | /api/code/snippets
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && segments[2] === 'snippets') {
    return snippetsPOST(request);
  }

  return executePOST(request);
}