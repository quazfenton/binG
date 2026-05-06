import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as rootGET, POST as rootPOST } from './main';
import { GET as contentGET } from './content/route';
import { POST as discoverPOST, GET as discoverGET } from './discover/route';
import { GET as feedGET, POST as feedPOST } from './feed/route';
import { GET as notificationsGET, POST as notificationsPOST } from './notifications/route';
import { GET as pluginsGET, POST as pluginsPOST, PUT as pluginsPUT, DELETE as pluginsDELETE } from './plugins/route';
import { POST as ssePOST, GET as sseGET } from './sse/route';
import { GET as statsGET } from './stats/route';
import { GET as triggerGET, POST as triggerPOST } from './trigger/route';
import { POST as webhookPOST, GET as webhookGET } from './webhook/route';

/**
 * Consolidated zine-display route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'content':
      return contentGET(request);
    case 'discover':
      return discoverGET(request);
    case 'feed':
      return feedGET(request);
    case 'notifications':
      return notificationsGET(request);
    case 'plugins':
      return pluginsGET(request);
    case 'sse':
      return sseGET(request);
    case 'stats':
      return statsGET();
    case 'trigger':
      return triggerGET(request);
    case 'webhook':
      return webhookGET(request);
    case 'root':
    default:
      return rootGET(request);
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'discover':
      return discoverPOST(request);
    case 'feed':
      return feedPOST(request);
    case 'notifications':
      return notificationsPOST(request);
    case 'plugins':
      return pluginsPOST(request);
    case 'sse':
      return ssePOST(request);
    case 'trigger':
      return triggerPOST(request);
    case 'webhook':
      return webhookPOST(request);
    case 'root':
    default:
      return rootPOST(request);
  }
}

export async function PUT(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'plugins':
      return pluginsPUT(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action for PUT. Use ?action=plugins' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'plugins':
      return pluginsDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action for DELETE. Use ?action=plugins' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}
