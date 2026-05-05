import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as apiKeysGET, POST as apiKeysPOST, DELETE as apiKeysDELETE } from './api-keys/route';
import { GET as deleteGET, POST as deletePOST } from './delete/route';
import { GET as integrationsStatusGET } from './integrations/status/route';
import { GET as keysGET, POST as keysPOST } from './keys/route';
import { GET as profileGET, PUT as profilePUT } from './profile/route';

/**
 * Consolidated user route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
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
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=api-keys|delete|integrations-status|keys|profile' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'api-keys':
      return apiKeysPOST(request);
    case 'delete':
      return deletePOST(request);
    case 'keys':
      return keysPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=api-keys|delete|keys' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function PUT(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'profile':
      return profilePUT(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=profile' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'api-keys':
      return apiKeysDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=api-keys' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}