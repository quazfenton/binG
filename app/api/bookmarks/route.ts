/**
 * Bookmarks API
 * 
 * CRUD operations for bookmark curation
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

const DATA_DIR = join(process.cwd(), 'data');
const BOOKMARKS_FILE = join(DATA_DIR, 'bookmarks.json');

export interface Bookmark {
  id: string;
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  tags?: string[];
  addedAt: number;
  updatedAt?: number;
}

// Ensure data directory exists
async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// Load bookmarks from file
async function loadBookmarks(): Promise<Bookmark[]> {
  await ensureDataDir();
  
  try {
    const data = await readFile(BOOKMARKS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Save bookmarks to file
async function saveBookmarks(bookmarks: Bookmark[]) {
  await ensureDataDir();
  await writeFile(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
}

// GET - List all bookmarks
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '100');
    const order = searchParams.get('order') || 'newest-first';

    const bookmarks = await loadBookmarks();

    // Sort by date
    bookmarks.sort((a, b) => {
      const comparison = b.addedAt - a.addedAt;
      return order === 'newest-first' ? comparison : -comparison;
    });

    // Apply limit
    const limited = bookmarks.slice(0, limit);

    return NextResponse.json({
      success: true,
      bookmarks: limited,
      total: bookmarks.length,
    });
  } catch (error: any) {
    console.error('Failed to load bookmarks:', error);
    return NextResponse.json(
      { error: 'Failed to load bookmarks' },
      { status: 500 }
    );
  }
}

// POST - Add new bookmarks
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookmarks: newBookmarks } = body;

    if (!Array.isArray(newBookmarks)) {
      return NextResponse.json(
        { error: 'Bookmarks must be an array' },
        { status: 400 }
      );
    }

    const existing = await loadBookmarks();
    const existingUrls = new Set(existing.map(b => b.url));

    // Filter out duplicates and add IDs
    const added: Bookmark[] = [];
    for (const bookmark of newBookmarks) {
      if (!bookmark.url || existingUrls.has(bookmark.url)) {
        continue;
      }

      const newBookmark: Bookmark = {
        id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        url: bookmark.url,
        title: bookmark.title,
        description: bookmark.description,
        imageUrl: bookmark.imageUrl,
        siteName: bookmark.siteName,
        tags: bookmark.tags || [],
        addedAt: bookmark.addedAt || Date.now(),
      };

      existing.push(newBookmark);
      added.push(newBookmark);
      existingUrls.add(bookmark.url);
    }

    await saveBookmarks(existing);

    return NextResponse.json({
      success: true,
      added: added.length,
      bookmarks: added,
    });
  } catch (error: any) {
    console.error('Failed to add bookmarks:', error);
    return NextResponse.json(
      { error: 'Failed to add bookmarks' },
      { status: 500 }
    );
  }
}

// DELETE - Remove bookmark
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Bookmark ID is required' },
        { status: 400 }
      );
    }

    const bookmarks = await loadBookmarks();
    const filtered = bookmarks.filter(b => b.id !== id);

    if (filtered.length === bookmarks.length) {
      return NextResponse.json(
        { error: 'Bookmark not found' },
        { status: 404 }
      );
    }

    await saveBookmarks(filtered);

    return NextResponse.json({
      success: true,
      message: 'Bookmark deleted',
    });
  } catch (error: any) {
    console.error('Failed to delete bookmark:', error);
    return NextResponse.json(
      { error: 'Failed to delete bookmark' },
      { status: 500 }
    );
  }
}

// PUT - Update bookmark
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Bookmark ID is required' },
        { status: 400 }
      );
    }

    const bookmarks = await loadBookmarks();
    const index = bookmarks.findIndex(b => b.id === id);

    if (index === -1) {
      return NextResponse.json(
        { error: 'Bookmark not found' },
        { status: 404 }
      );
    }

    bookmarks[index] = {
      ...bookmarks[index],
      ...updates,
      updatedAt: Date.now(),
    };

    await saveBookmarks(bookmarks);

    return NextResponse.json({
      success: true,
      bookmark: bookmarks[index],
    });
  } catch (error: any) {
    console.error('Failed to update bookmark:', error);
    return NextResponse.json(
      { error: 'Failed to update bookmark' },
      { status: 500 }
    );
  }
}
