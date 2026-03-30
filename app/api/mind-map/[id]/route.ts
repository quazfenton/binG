/**
 * Mind Map By ID API
 *
 * GET /api/mind-map/[id] - Get specific mind map
 */

import { NextRequest, NextResponse } from 'next/server';

// In-memory store (shared with main route)
const mindMaps = new Map<string, any>();

// Seed with sample mind maps if empty
if (mindMaps.size === 0) {
  mindMaps.set('sample-1', {
    id: 'sample-1',
    title: 'Project Planning',
    nodes: [
      { id: 'root', text: 'Project Goals', x: 400, y: 300, color: '#8B5CF6' },
      { id: 'node-1', text: 'Research', parentId: 'root', x: 200, y: 150, color: '#3B82F6' },
      { id: 'node-2', text: 'Development', parentId: 'root', x: 600, y: 150, color: '#10B981' },
      { id: 'node-3', text: 'Testing', parentId: 'root', x: 400, y: 450, color: '#F59E0B' },
    ],
    createdAt: Date.now() - 86400000 * 5,
    updatedAt: Date.now() - 86400000 * 2,
    isPublic: true,
  });

  mindMaps.set('sample-2', {
    id: 'sample-2',
    title: 'Learning Path',
    nodes: [
      { id: 'root', text: 'Web Development', x: 400, y: 300, color: '#EC4899' },
      { id: 'node-1', text: 'HTML/CSS', parentId: 'root', x: 200, y: 150, color: '#F97316' },
      { id: 'node-2', text: 'JavaScript', parentId: 'root', x: 600, y: 150, color: '#FACC15' },
    ],
    createdAt: Date.now() - 86400000 * 10,
    updatedAt: Date.now() - 86400000 * 7,
    isPublic: true,
  });
}

/**
 * GET /api/mind-map/[id] - Get specific mind map
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
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
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const mindMap = mindMaps.get(id);

    if (!mindMap) {
      return NextResponse.json(
        { error: 'Mind map not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
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
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

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
