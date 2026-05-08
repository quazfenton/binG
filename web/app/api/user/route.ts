import { NextRequest, NextResponse } from 'next/server';
import { GET as apiKeysGET, POST as apiKeysPOST, DELETE as apiKeysDELETE } from './api-keys/gateway';
import { GET as deleteGET, POST as deletePOST } from './delete/gateway';
import { GET as integrationsStatusGET } from './integrations/status/gateway';
import { GET as keysGET, POST as keysPOST } from './keys/gateway';
import { GET as profileGET, PUT as profilePUT } from './profile/gateway';

/**
 * Consolidated user route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length !== 3) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  switch (segments[2]) {
    case 'api-keys': return apiKeysGET(request);
    case 'delete': return deleteGET(request);
    case 'integrations-status': return integrationsStatusGET(request);
    case 'keys': return keysGET(request);
    case 'profile': return profileGET(request);
    default: return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length !== 3) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  switch (segments[2]) {
    case 'api-keys': return apiKeysPOST(request);
    case 'delete': return deletePOST(request);
    case 'keys': return keysPOST(request);
    default: return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function PUT(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3 && segments[2] === 'profile') return profilePUT(request);
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 3 && segments[2] === 'api-keys') return apiKeysDELETE(request);
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}