/**
 * Mind Map API
 *
 * Create, edit, and manage mind maps
 * Supports real-time collaboration and export
 */

import { NextRequest, NextResponse } from 'next/server';


import { mindMaps, type MindMap, type MindMapNode } from './store';

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
