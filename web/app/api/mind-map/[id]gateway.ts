/**
 * Mind Map By ID API
 *
 * GET /api/mind-map/[id] - Get specific mind map
 * PUT /api/mind-map/[id] - Update mind map
 * DELETE /api/mind-map/[id] - Delete mind map
 *
 * ⚠️ LIMITATION: Uses in-memory storage (Map) which is NOT suitable for production.
 * Data will be lost on server restart and is not shared across server instances.
 * For production use, replace with a database (PostgreSQL, MongoDB, etc.).
 */

import { NextRequest, NextResponse } from 'next/server';


import { mindMaps, type MindMap, type MindMapNode } from '../store';

/**
 * Validate mind map ID format
 */
function isValidMindMapId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && /^[\w-]+$/.test(id);
}

/**
 * GET /api/mind-map/[id] - Get specific mind map
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  // Validate ID format
  if (!isValidMindMapId(id)) {
    return NextResponse.json(
      { error: 'Invalid mind map ID format' },
      { status: 400 }
    );
  }
  
  try {
    const mindMap = mindMaps.get(id);

    if (!mindMap) {
      return NextResponse.json(
        { error: 'Mind map not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      mindMap,
    });
  } catch (error: any) {
    console.error('[Mind Map API] GET by ID error:', error);
    return NextResponse.json(
      { error: 'Failed to get mind map' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mind-map/[id] - Update mind map
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  // Validate ID format
  if (!isValidMindMapId(id)) {
    return NextResponse.json(
      { error: 'Invalid mind map ID format' },
      { status: 400 }
    );
  }
  
  try {
    const mindMap = mindMaps.get(id);

    if (!mindMap) {
      return NextResponse.json(
        { error: 'Mind map not found' },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Validate body is a non-null object
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    // Validate input types
    if (body.title !== undefined && typeof body.title !== 'string') {
      return NextResponse.json(
        { error: 'Title must be a string' },
        { status: 400 }
      );
    }
    if (body.nodes !== undefined && !Array.isArray(body.nodes)) {
      return NextResponse.json(
        { error: 'Nodes must be an array' },
        { status: 400 }
      );
    }
    if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean') {
      return NextResponse.json(
        { error: 'isPublic must be a boolean' },
        { status: 400 }
      );
    }

    const { title, nodes, isPublic } = body;

    const updated: MindMap = {
      ...mindMap,
      title: title ?? mindMap.title,
      nodes: nodes ?? mindMap.nodes,
      isPublic: isPublic ?? mindMap.isPublic,
      updatedAt: Date.now(),
    };

    mindMaps.set(id, updated);

    return NextResponse.json({
      success: true,
      mindMap: updated,
    });
  } catch (error: any) {
    console.error('[Mind Map API] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update mind map' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mind-map/[id] - Delete mind map
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  
  // Validate ID format
  if (!isValidMindMapId(id)) {
    return NextResponse.json(
      { error: 'Invalid mind map ID format' },
      { status: 400 }
    );
  }
  
  try {

    if (!mindMaps.has(id)) {
      return NextResponse.json(
        { error: 'Mind map not found' },
        { status: 404 }
      );
    }

    mindMaps.delete(id);

    return NextResponse.json({
      success: true,
      message: 'Mind map deleted',
    });
  } catch (error: any) {
    console.error('[Mind Map API] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete mind map' },
      { status: 500 }
    );
  }
}
