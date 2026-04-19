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

interface Bookmark {
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
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      throw new Error('Bookmarks file does not contain an array');
    }
    return parsed as Bookmark[];
  } catch (error: unknown) {
    // Only return empty array if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    // Log and rethrow all other errors (corruption, permissions, etc.)
    console.error('Failed to read bookmarks file:', BOOKMARKS_FILE, error);
    throw error;
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

    // Filter out duplicates and add IDs with field validation
    const added: Bookmark[] = [];
    for (const bookmark of newBookmarks) {
      // Validate required fields
      if (!bookmark || typeof bookmark !== 'object') {
        continue;
      }

      const url = bookmark.url;
      if (!url || typeof url !== 'string') {
        continue;
      }

      // Validate URL format (must be HTTP/HTTPS)
      try {
        const urlObj = new URL(url);
        if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
          continue;
        }
      } catch {
        continue;
      }

      // Skip if already exists
      if (existingUrls.has(url)) {
        continue;
      }

      // Whitelist only allowed fields with type validation
      const newBookmark: Bookmark = {
        id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        url,
        title: typeof bookmark.title === 'string' ? bookmark.title : undefined,
        description: typeof bookmark.description === 'string' ? bookmark.description : undefined,
        imageUrl: typeof bookmark.imageUrl === 'string' ? bookmark.imageUrl : undefined,
        siteName: typeof bookmark.siteName === 'string' ? bookmark.siteName : undefined,
        tags: Array.isArray(bookmark.tags) ? bookmark.tags.filter(t => typeof t === 'string') : [],
        addedAt: typeof bookmark.addedAt === 'number' ? bookmark.addedAt : Date.now(),
      };

      existing.push(newBookmark);
      added.push(newBookmark);
      existingUrls.add(url);
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

    if (!id || typeof id !== 'string') {
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

    // Whitelist only allowed mutable fields with type validation
    const allowedUpdates: Partial<Bookmark> = {};
    
    if (typeof updates.title === 'string') {
      allowedUpdates.title = updates.title;
    }
    if (typeof updates.description === 'string') {
      allowedUpdates.description = updates.description;
    }
    if (typeof updates.imageUrl === 'string') {
      allowedUpdates.imageUrl = updates.imageUrl;
    }
    if (typeof updates.siteName === 'string') {
      allowedUpdates.siteName = updates.siteName;
    }
    if (Array.isArray(updates.tags)) {
      allowedUpdates.tags = updates.tags.filter(t => typeof t === 'string');
    }

    // Prevent overwriting immutable fields (id, addedAt, url)
    bookmarks[index] = {
      ...bookmarks[index],
      ...allowedUpdates,
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
