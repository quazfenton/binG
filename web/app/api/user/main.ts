import { NextRequest, NextResponse } from 'next/server';

import { GET as apiKeysGET, POST as apiKeysPOST, DELETE as apiKeysDELETE } from './api-keys/gateway';
import { GET as deleteGET, POST as deletePOST } from './delete/gateway';
import { GET as integrationsStatusGET } from './integrations/status/gateway';
import { GET as keysGET, POST as keysPOST } from './keys/gateway';
import { GET as profileGET, PUT as profilePUT } from './profile/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /user/api-keys|/user/delete|/user/integrations-status|/user/keys|/user/profile' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'api-keys':
      return apiKeysGET(request);
    case 'delete':
      return deleteGET(request);
    case 'integrations-status':
      return integrationsStatusGET(request);
    case 'keys':
      return keysGET(request);
    case 'profile':
      return profileGET(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /user/api-keys|/user/delete|/user/integrations-status|/user/keys|/user/profile' }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /user/api-keys|/user/delete|/user/keys' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'api-keys':
      return apiKeysPOST(request);
    case 'delete':
      return deletePOST(request);
    case 'keys':
      return keysPOST(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /user/api-keys|/user/delete|/user/keys' }, { status: 404 });
  }
}

export async function PUT(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /user/profile' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'profile':
      return profilePUT(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /user/profile' }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json({ error: 'Not found. Use /user/api-keys' }, { status: 404 });
  }

  switch (segments[2]) {
    case 'api-keys':
      return apiKeysDELETE(request);
    default:
      return NextResponse.json({ error: 'Not found. Use /user/api-keys' }, { status: 404 });
  }
}