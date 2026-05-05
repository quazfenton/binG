import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as apiKeysGET, POST as apiKeysPOST, DELETE as apiKeysDELETE } from './api-keys/route';
import { DELETE as deleteDELETE } from './delete/route';
import { GET as integrationsStatusGET } from './integrations/status/route';
import { GET as keysGET, POST as keysPOST, DELETE as keysDELETE } from './keys/route';
import { GET as preferencesGET, PUT as preferencesPUT } from './preferences/route';
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
    case 'integrations-status':
      return integrationsStatusGET(request);
    case 'keys':
      return keysGET(request);
    case 'preferences':
      return preferencesGET(request);
    case 'profile':
      return profileGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=api-keys|integrations-status|keys|preferences|profile' }),
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
    case 'keys':
      return keysPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=api-keys|keys' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function PUT(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'preferences':
      return preferencesPUT(request);
    case 'profile':
      return profilePUT(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=preferences|profile' }),
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
    case 'keys':
      return keysDELETE(request);
    case 'delete':
      return deleteDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=api-keys|keys|delete' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}