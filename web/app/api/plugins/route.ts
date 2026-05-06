import { NextRequest, NextResponse } from 'next/server';

import { GET as rootGET } from './main';
import { GET as installedGET } from './installed/gateway';
import { GET as marketplaceGET } from './marketplace/gateway';
import { GET as marketplaceSearchGET } from './marketplace/search/gateway';
import { PUT as configPUT, POST as configPOST } from './[id]/config/gateway';
import { POST as actionPOST } from './[id]/[action]/gateway';

// GET /api/plugins | /api/plugins/installed | /api/plugins/marketplace | /api/plugins/marketplace/search
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 3) {
    if (segments[2] === 'installed') return installedGET();
    if (segments[2] === 'marketplace') return marketplaceGET(request);
    if (segments[2] === 'marketplace-search') return marketplaceSearchGET(request);
    return rootGET();
  }
  if (segments.length === 4 && segments[2] === 'marketplace' && segments[3] === 'search') {
    return marketplaceSearchGET(request);
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// POST /api/plugins/[id]/config | /api/plugins/[id]/[action]
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 4 && segments[2] !== 'marketplace') {
    const id = segments[3];
    // /api/plugins/[id]/config — dispatch to config gateway
    const configSegments = path.split('/').filter(Boolean);
    if (configSegments.length === 5 && configSegments[4] === 'config') {
      return configPOST(request, { params: Promise.resolve({ id }) });
    }
    // /api/plugins/[id]/[action] — passthrough
    return actionPOST(request, { params: Promise.resolve({ id, action: configSegments[4] || '' }) });
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

// PUT /api/plugins/[id]/config
export async function PUT(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 5 && segments[2] !== 'marketplace' && segments[4] === 'config') {
    const id = segments[3];
    return configPUT(request, { params: Promise.resolve({ id }) });
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}