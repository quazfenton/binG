/**
 * Mind Map API
 *
 * Create, edit, and manage mind maps
 * Supports real-time collaboration and export
 */

import { NextRequest, NextResponse } from 'next/server';

export interface MindMap {
  id: string;
  title: string;
  nodes: MindMapNode[];
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
}

export interface MindMapNode {
  id: string;
  text: string;
  parentId?: string;
  x: number;
  y: number;
  color?: string;
  icon?: string;
}

// In-memory store (use database in production)
const mindMaps = new Map<string, MindMap>();

// Seed with sample mind maps
mindMaps.set('sample-1', {
  id: 'sample-1',
  title: 'Project Planning',
  nodes: [
    { id: 'root', text: 'Project Goals', x: 400, y: 300, color: '#8B5CF6' },
    { id: 'node-1', text: 'Research', parentId: 'root', x: 200, y: 150, color: '#3B82F6' },
    { id: 'node-2', text: 'Development', parentId: 'root', x: 600, y: 150, color: '#10B981' },
    { id: 'node-3', text: 'Testing', parentId: 'root', x: 400, y: 450, color: '#F59E0B' },
    { id: 'node-4', text: 'Market Analysis', parentId: 'node-1', x: 100, y: 50, color: '#3B82F6' },
    { id: 'node-5', text: 'Competitor Research', parentId: 'node-1', x: 300, y: 50, color: '#3B82F6' },
    { id: 'node-6', text: 'Frontend', parentId: 'node-2', x: 500, y: 50, color: '#10B981' },
    { id: 'node-7', text: 'Backend', parentId: 'node-2', x: 700, y: 50, color: '#10B981' },
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
    { id: 'node-3', text: 'React', parentId: 'node-2', x: 500, y: 50, color: '#3B82F6' },
    { id: 'node-4', text: 'Node.js', parentId: 'node-2', x: 700, y: 50, color: '#10B981' },
  ],
  createdAt: Date.now() - 86400000 * 10,
  updatedAt: Date.now() - 86400000 * 7,
  isPublic: true,
});

/**
 * GET /api/mind-map - List mind maps
 * 
 * Query parameters:
 * - public: Only public mind maps (default: true)
 * - search: Search in title
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const isPublic = searchParams.get('public') !== 'false';
    const search = searchParams.get('search');

    let maps = Array.from(mindMaps.values());

    // Filter by public
    if (isPublic) {
      maps = maps.filter(m => m.isPublic);
    }

    // Search in title
    if (search) {
      const searchLower = search.toLowerCase();
      maps = maps.filter(m => m.title.toLowerCase().includes(searchLower));
    }

    return NextResponse.json({
      success: true,
      mindMaps: maps,
      total: maps.length,
    });
  } catch (error: any) {
    console.error('[Mind Map API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to load mind maps' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/mind-map/:id - Get specific mind map
 */
export async function GETById(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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
 * POST /api/mind-map - Create new mind map
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, nodes = [] } = body;

    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    const newMap: MindMap = {
      id: `mindmap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      nodes: nodes.length > 0 ? nodes : [
        { id: 'root', text: 'Central Idea', x: 400, y: 300, color: '#8B5CF6' }
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: body.isPublic ?? false,
    };

    mindMaps.set(newMap.id, newMap);

    return NextResponse.json({
      success: true,
      mindMap: newMap,
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Mind Map API] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create mind map' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mind-map/:id - Update mind map
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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
 * DELETE /api/mind-map/:id - Delete mind map
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
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
