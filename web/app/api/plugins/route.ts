import { NextRequest } from 'next/server';

// Import all existing handlers
import { GET as rootGET } from './main';
import { GET as installedGET } from './installed/gateway';
import { GET as marketplaceGET } from './marketplace/gateway';
import { GET as marketplaceSearchGET } from './marketplace/search/gateway';
import { PUT as configPUT, POST as configPOST } from './[id]/config/gateway';
import { POST as actionPOST } from './[id]/[action]/gateway';

/**
 * Consolidated plugins route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'installed':
      return installedGET();
    case 'marketplace':
      return marketplaceGET(request);
    case 'marketplace-search':
      return marketplaceSearchGET(request);
    case 'root':
    default:
      return rootGET();
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const id = searchParams.get('id');
  const pluginAction = searchParams.get('pluginAction');

  switch (action) {
    case 'config':
      if (!id) {
        return new Response(
          JSON.stringify({ error: 'id query parameter is required for config action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return configPOST(request, { params: Promise.resolve({ id }) });
    case 'plugin-action':
      if (!id || !pluginAction) {
        return new Response(
          JSON.stringify({ error: 'id and pluginAction query parameters are required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return actionPOST(request, { params: Promise.resolve({ id, action: pluginAction }) });
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=config|plugin-action' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function PUT(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const id = searchParams.get('id');

  switch (action) {
    case 'config':
      if (!id) {
        return new Response(
          JSON.stringify({ error: 'id query parameter is required for config action' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return configPUT(request, { params: Promise.resolve({ id }) });
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action for PUT. Use ?action=config' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}
