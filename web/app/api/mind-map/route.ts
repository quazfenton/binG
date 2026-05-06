/**
 * Consolidated Mind Map API
 * 
 * Routes:
 * - GET /api/mind-map?action=list - List mind maps
 * - POST /api/mind-map?action=create - Create mind map
 * - GET /api/mind-map?action=stats - Get stats
 * - GET /api/mind-map?action=chains - List reasoning chains
 * - GET /api/mind-map?action=chain - Get single chain by ID
 * - GET /api/mind-map?action=get - Get single mind map by ID
 * - PUT /api/mind-map?action=update - Update mind map
 * - DELETE /api/mind-map?action=delete - Delete mind map
 */

import { NextRequest, NextResponse } from 'next/server';

// Import handlers from existing route files
import { GET as rootGET, POST as rootPOST } from './main';
import { GET as statsGET } from './stats/route';
import { GET as chainsGET } from './chains/route';
import { GET as chainByIdGET } from './chains/[id]/route';
import { GET as getMindMapGET, PUT as updateMindMapPUT, DELETE as deleteMindMapDELETE } from './[id]/route';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';

  switch (action) {
    case 'list':
      return rootGET(request);
    case 'stats':
      return statsGET();
    case 'chains':
      return chainsGET(request);
    case 'chain':
      return chainByIdGET(request, { params: Promise.resolve({ id: searchParams.get('id') || '' }) });
    case 'get':
      return getMindMapGET(request, { params: Promise.resolve({ id: searchParams.get('id') || '' }) });
    default:
      return rootGET(request);
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'create';

  switch (action) {
    case 'create':
      return rootPOST(request);
    default:
      return rootPOST(request);
  }
}

export async function PUT(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'update';

  switch (action) {
    case 'update':
      return updateMindMapPUT(request, { params: Promise.resolve({ id: searchParams.get('id') || '' }) });
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'delete';

  switch (action) {
    case 'delete':
      return deleteMindMapDELETE(request, { params: Promise.resolve({ id: searchParams.get('id') || '' }) });
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}