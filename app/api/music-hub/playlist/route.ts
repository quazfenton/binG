/**
 * Music Hub Playlist API v2 - Production Ready
 *
 * Features:
 * - Rate limiting
 * - Input validation
 * - Error handling
 * - CORS headers
 * - Cache control
 * - Graceful degradation
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "data");
const PLAYLIST_PATH = join(DATA_DIR, "music-hub-playlist.json");

// Rate limiting configuration
const RATE_LIMIT = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 requests per minute
};

// Rate limit store (in-memory for now)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Default playlist
const DEFAULT_PLAYLIST = {
  albums: [
    {
      id: "album-1",
      title: "Neon Dreams",
      artist: "Digital Underground",
      releaseDate: "2026-03-15",
      playlistUrl: "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      playlistId: "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      coverUrl: "https://picsum.photos/seed/neondreams/400/400",
      isNew: true,
      isFeatured: true,
      songs: [
        {
          id: "song-1-1",
          title: "Midnight Protocol",
          artist: "Digital Underground",
          album: "Neon Dreams",
          videoId: "dQw4w9WgXcQ",
          duration: 245,
          thumbnailUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
          liked: false,
          played: false,
        },
        {
          id: "song-1-2",
          title: "Binary Sunset",
          artist: "Digital Underground",
          album: "Neon Dreams",
          videoId: "9bZkp7q19f0",
          duration: 198,
          thumbnailUrl: "https://img.youtube.com/vi/9bZkp7q19f0/maxresdefault.jpg",
          liked: true,
          played: false,
        },
      ],
    },
  ],
  lastUpdated: new Date().toISOString(),
  autoUpdate: true,
};

// Check rate limit
function checkRateLimit(identifier: string): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + RATE_LIMIT.windowMs,
    });
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1, resetTime: now + RATE_LIMIT.windowMs };
  }

  if (record.count >= RATE_LIMIT.maxRequests) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT.maxRequests - record.count, resetTime: record.resetTime };
}

// Ensure data directory exists
async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// Read playlist with safe fallback
async function readPlaylist(): Promise<any> {
  try {
    await ensureDataDir();
    const data = await readFile(PLAYLIST_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    // Only create default playlist if file doesn't exist
    // For other errors (parse failures, read errors), rethrow to caller
    if (error.code === 'ENOENT') {
      await writeFile(PLAYLIST_PATH, JSON.stringify(DEFAULT_PLAYLIST, null, 2));
      return DEFAULT_PLAYLIST;
    }
    // Log error for debugging but don't overwrite production data
    console.error('[Playlist] Failed to read playlist:', error.message);
    throw error;
  }
}

// Write playlist with error handling
async function writePlaylist(playlist: any): Promise<void> {
  await ensureDataDir();
  await writeFile(PLAYLIST_PATH, JSON.stringify(playlist, null, 2));
}

// Validate album data
function validateAlbum(album: any): { valid: boolean; error?: string } {
  if (!album || typeof album !== 'object') {
    return { valid: false, error: 'Album must be an object' };
  }

  if (!album.title || typeof album.title !== 'string') {
    return { valid: false, error: 'Album title is required' };
  }

  if (!album.artist || typeof album.artist !== 'string') {
    return { valid: false, error: 'Album artist is required' };
  }

  if (album.songs && !Array.isArray(album.songs)) {
    return { valid: false, error: 'Songs must be an array' };
  }

  return { valid: true };
}

// GET - Retrieve playlist
export async function GET(request: NextRequest) {
  // Use x-forwarded-for header instead of request.ip (which doesn't exist in Next.js)
  const clientId = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`get:${clientId}`);

  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(rateLimit.resetTime / 1000).toString(),
    'Cache-Control': 'public, max-age=60',
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers }
    );
  }

  try {
    const playlist = await readPlaylist();
    
    return NextResponse.json(
      {
        success: true,
        playlist,
        timestamp: new Date().toISOString(),
      },
      { headers }
    );
  } catch (error) {
    console.error('[MusicHub API] GET error:', error);
    return NextResponse.json(
      {
        success: true,
        playlist: DEFAULT_PLAYLIST,
        error: 'Failed to read playlist, returning default',
      },
      { headers }
    );
  }
}

// POST - Update playlist
export async function POST(request: NextRequest) {
  // Use x-forwarded-for header instead of request.ip (which doesn't exist in Next.js)
  const clientId = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`post:${clientId}`);

  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(rateLimit.resetTime / 1000).toString(),
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers }
    );
  }

  try {
    const body = await request.json();
    const { action, album, playlist: newPlaylist, webhookSecret } = body;

    // Validate webhook secret if configured
    const expectedSecret = process.env.MUSIC_HUB_WEBHOOK_SECRET;
    if (expectedSecret && webhookSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid webhook secret' },
        { status: 401, headers }
      );
    }

    const currentPlaylist = await readPlaylist();

    switch (action) {
      case 'add_album': {
        const validation = validateAlbum(album);
        if (!validation.valid) {
          return NextResponse.json(
            { success: false, error: validation.error },
            { status: 400, headers }
          );
        }

        const newAlbum = {
          ...album,
          id: album.id || `album-${Date.now()}`,
          isNew: album.isNew ?? true,
          isFeatured: album.isFeatured ?? false,
          songs: album.songs || [],
          addedAt: new Date().toISOString(),
        };

        currentPlaylist.albums.unshift(newAlbum);
        break;
      }

      case 'remove_album': {
        if (!album?.id) {
          return NextResponse.json(
            { success: false, error: 'Album ID required' },
            { status: 400, headers }
          );
        }

        const albumIndex = currentPlaylist.albums.findIndex((a: any) => a.id === album.id);
        if (albumIndex === -1) {
          return NextResponse.json(
            { success: false, error: 'Album not found' },
            { status: 404, headers }
          );
        }

        currentPlaylist.albums.splice(albumIndex, 1);
        break;
      }

      case 'update_album': {
        if (!album?.id) {
          return NextResponse.json(
            { success: false, error: 'Album ID required' },
            { status: 400, headers }
          );
        }

        const albumIndex = currentPlaylist.albums.findIndex((a: any) => a.id === album.id);
        if (albumIndex === -1) {
          return NextResponse.json(
            { success: false, error: 'Album not found' },
            { status: 404, headers }
          );
        }

        currentPlaylist.albums[albumIndex] = {
          ...currentPlaylist.albums[albumIndex],
          ...album,
          lastUpdated: new Date().toISOString(),
        };
        break;
      }

      case 'replace_playlist': {
        if (!newPlaylist || !newPlaylist.albums || !Array.isArray(newPlaylist.albums)) {
          return NextResponse.json(
            { success: false, error: 'Valid playlist data required' },
            { status: 400, headers }
          );
        }

        Object.assign(currentPlaylist, {
          ...newPlaylist,
          lastUpdated: new Date().toISOString(),
        });
        break;
      }

      case 'sync_playlist': {
        if (!album?.playlistUrl) {
          return NextResponse.json(
            { success: false, error: 'Playlist URL required' },
            { status: 400, headers }
          );
        }

        // Validate playlist ID before persisting
        const playlistId = extractPlaylistId(album.playlistUrl);
        
        // Reject if null or clearly a video ID (starts with underscore or is too short)
        if (!playlistId || playlistId.startsWith('_') || playlistId.length < 10) {
          return NextResponse.json(
            { success: false, error: 'Invalid playlist URL. Ensure it contains a valid YouTube playlist ID (e.g., ?list=PL...)' },
            { status: 400, headers }
          );
        }

        currentPlaylist.pendingSync = {
          playlistId,
          requestedAt: new Date().toISOString(),
          status: 'pending',
        };
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400, headers }
        );
    }

    currentPlaylist.lastUpdated = new Date().toISOString();
    await writePlaylist(currentPlaylist);

    return NextResponse.json(
      {
        success: true,
        message: `Action "${action}" completed successfully`,
        playlist: currentPlaylist,
      },
      { headers }
    );
  } catch (error) {
    console.error('[MusicHub API] POST error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update playlist',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, headers }
    );
  }
}

// Helper function to extract YouTube playlist ID
function extractPlaylistId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com')) {
      return urlObj.searchParams.get('list');
    }
    if (urlObj.hostname.includes('youtu.be')) {
      return urlObj.pathname.slice(1);
    }
    return null;
  } catch {
    return null;
  }
}
