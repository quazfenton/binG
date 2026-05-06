import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as configGET, POST as configPOST } from './config/gateway';
import { GET as contentGET, POST as contentPOST, DELETE as contentDELETE } from './content/gateway';
import { GET as rssProxyGET } from './rss-proxy/gateway';
import { GET as webhookGET, POST as webhookPOST } from './webhook/gateway';

/**
 * Consolidated zine route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'config':
      return configGET(request);
    case 'content':
      return contentGET(request);
    case 'rss-proxy':
      return rssProxyGET(request);
    case 'webhook':
      return webhookGET();
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=config|content|rss-proxy|webhook' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'config':
      return configPOST(request);
    case 'content':
      return contentPOST(request);
    case 'webhook':
      return webhookPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=config|content|webhook' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'content':
      return contentDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=content' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}
