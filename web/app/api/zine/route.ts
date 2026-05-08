import { NextRequest, NextResponse } from 'next/server';

import { GET as configGET, POST as configPOST } from './config/gateway';
import { GET as contentGET, POST as contentPOST, DELETE as contentDELETE } from './content/gateway';
import { GET as rssProxyGET } from './rss-proxy/gateway';
import { GET as webhookGET, POST as webhookPOST } from './webhook/gateway';

// GET /api/zine/config | /api/zine/content | /api/zine/rss-proxy | /api/zine/webhook
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.endsWith('/config')) return configGET(request);
  if (path.endsWith('/content')) return contentGET(request);
  if (path.endsWith('/rss-proxy')) return rssProxyGET(request);
  if (path.endsWith('/webhook')) return webhookGET();

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// POST /api/zine/config | /api/zine/content | /api/zine/webhook
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.endsWith('/config')) return configPOST(request);
  if (path.endsWith('/content')) return contentPOST(request);
  if (path.endsWith('/webhook')) return webhookPOST(request);

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// DELETE /api/zine/content
export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.endsWith('/content')) return contentDELETE(request);
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
