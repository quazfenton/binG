import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET, POST as rootPOST } from './main';
import { GET as contentGET } from './content/gateway';
import { POST as discoverPOST, GET as discoverGET } from './discover/gateway';
import { GET as feedGET, POST as feedPOST } from './feed/gateway';
import { GET as notificationsGET, POST as notificationsPOST } from './notifications/gateway';
import { GET as pluginsGET, POST as pluginsPOST, PUT as pluginsPUT, DELETE as pluginsDELETE } from './plugins/gateway';
import { POST as ssePOST, GET as sseGET } from './sse/gateway';
import { GET as statsGET } from './stats/gateway';
import { GET as triggerGET, POST as triggerPOST } from './trigger/gateway';
import { POST as webhookPOST, GET as webhookGET } from './webhook/gateway';

// GET /api/zine-display | /api/zine-display/content | /api/zine-display/discover | ...
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3) {
    switch (segments[2]) {
      case 'content': return contentGET(request);
      case 'discover': return discoverGET(request);
      case 'feed': return feedGET(request);
      case 'notifications': return notificationsGET(request);
      case 'plugins': return pluginsGET(request);
      case 'sse': return sseGET(request);
      case 'stats': return statsGET();
      case 'trigger': return triggerGET(request);
      case 'webhook': return webhookGET(request);
      default: return rootGET(request);
    }
  }

  return rootGET(request);
}

// POST /api/zine-display/[section]
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3) {
    switch (segments[2]) {
      case 'discover': return discoverPOST(request);
      case 'feed': return feedPOST(request);
      case 'notifications': return notificationsPOST(request);
      case 'plugins': return pluginsPOST(request);
      case 'sse': return ssePOST(request);
      case 'trigger': return triggerPOST(request);
      case 'webhook': return webhookPOST(request);
      default: return rootPOST(request);
    }
  }

  return rootPOST(request);
}

// PUT /api/zine-display/plugins
export async function PUT(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && segments[2] === 'plugins') {
    return pluginsPUT(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// DELETE /api/zine-display/plugins
export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3 && segments[2] === 'plugins') {
    return pluginsDELETE(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}