/**
 * Webhooks API
 * Consolidated route — dispatches to sub-handler route.ts files.
 *
 * Endpoints:
 * - GET  /api/webhooks - Health check (main.ts)
 * - POST /api/webhooks?provider=arcade|nango - Arcade/Nango webhook (main.ts)
 * - POST /api/webhooks/blaxel-callback - Blaxel callback (blaxel-callback/route.ts)
 * - POST /api/webhooks/composio - Composio webhook (composio/route.ts)
 * - POST /api/webhooks/nango - Nango webhook (nango/route.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET, POST as rootPOST } from './main';
import { GET as blaxelGET, POST as blaxelPOST } from './blaxel-callback/gateway';
import { GET as composioGET, POST as composioPOST, OPTIONS as composioOPTIONS } from './composio/gateway';
import { GET as nangoGET, POST as nangoPOST } from './nango/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/webhooks/blaxel-callback -> blaxel gateway
  if (path.endsWith('/blaxel-callback')) {
    return blaxelGET();
  }

  // /api/webhooks/composio -> composio gateway
  if (path.endsWith('/composio')) {
    return composioGET();
  }

  // /api/webhooks/nango -> nango gateway
  if (path.endsWith('/nango')) {
    return nangoGET();
  }

  // /api/webhooks -> main handler
  return rootGET();
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/webhooks/blaxel-callback -> blaxel route
  if (path.endsWith('/blaxel-callback')) {
    return blaxelPOST(request);
  }

  // /api/webhooks/composio -> composio route
  if (path.endsWith('/composio')) {
    return composioPOST(request);
  }

  // /api/webhooks/nango -> nango route
  if (path.endsWith('/nango')) {
    return nangoPOST(request);
  }

  // /api/webhooks?provider=... -> main handler (arcade/nango)
  return rootPOST(request);
}

export async function OPTIONS(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api/webhooks/composio -> composio gateway
  if (path.endsWith('/composio')) {
    return composioOPTIONS(request);
  }

  return NextResponse.json({}, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}