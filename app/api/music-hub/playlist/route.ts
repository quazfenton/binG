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
 * 
 * Uses data/playlists.json as the standard storage format
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { timingSafeEqual } from "crypto";

const DATA_DIR = join(process.cwd(), "data");
const PLAYLIST_PATH = join(DATA_DIR, "playlists.json");

// Rate limiting configuration
const RATE_LIMIT = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 requests per minute
};

// Rate limit store (in-memory for now)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Constant-time comparison for webhook secrets to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Lengths must match
  if (bufA.length !== bufB.length) return false;

  // Use timing-safe comparison
  return timingSafeEqual(bufA, bufB);
}

/**
 * Parse artist and album title from playlist title
 * Format: "Artist - Album Title (Full Album)"
 */
function parseArtistAndAlbum(playlistTitle: string): { artist: string; albumTitle: string } {
  const dashIndex = playlistTitle.indexOf(' - ');
  if (dashIndex === -1) {
    return { artist: 'Unknown Artist', albumTitle: playlistTitle };
  }
  
  const artist = playlistTitle.substring(0, dashIndex).trim();
  const albumTitle = playlistTitle.substring(dashIndex + 3).trim();
  
  return { artist, albumTitle };
}

/**
 * Generate cover URL from playlist ID or title
 */
function generateCoverUrl(playlistId: string, title: string): string {
  return `https://picsum.photos/seed/${playlistId || title}/400/400`;
}

/**
 * Generate thumbnail URL for a video
 */
function generateThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

/**
 * Check if playlist is recent (within 30 days)
 */
function isRecent(discoveredAt: string): boolean {
  const discovered = new Date(discoveredAt);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - discovered.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff <= 30;
}

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

/**
 * Read playlists from data/playlists.json
 * Returns array of playlist entries
 */
async function readPlaylists(): Promise<any[]> {
  try {
    await ensureDataDir();
    const data = await readFile(PLAYLIST_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    // Only create default empty array if file doesn't exist
    if (error.code === 'ENOENT') {
      const defaultPlaylists: any[] = [];
      await writeFile(PLAYLIST_PATH, JSON.stringify(defaultPlaylists, null, 2));
      return defaultPlaylists;
    }
    // Log error for debugging but don't overwrite production data
    console.error('[Playlist] Failed to read playlist:', error.message);
    throw error;
  }
}

/**
 * Write playlists to data/playlists.json
 */
async function writePlaylists(playlists: any[]): Promise<void> {
  await ensureDataDir();
  await writeFile(PLAYLIST_PATH, JSON.stringify(playlists, null, 2));
}

/**
 * Convert a playlist entry to the enriched format with songs
 */
function enrichPlaylist(playlist: any): any {
  const { artist } = playlist.artist 
    ? { artist: playlist.artist }
    : parseArtistAndAlbum(playlist.title || '');
  
  return {
    id: playlist.playlist_id,
    playlist_id: playlist.playlist_id,
    title: playlist.title,
    artist: artist,
    link: playlist.link,
    discovered_at: playlist.discovered_at,
    isNew: isRecent(playlist.discovered_at),
    isFeatured: playlist.isFeatured || false,
    coverUrl: playlist.coverUrl || generateCoverUrl(playlist.playlist_id, playlist.title),
    songs: (playlist.videos || []).map((videoId: string, index: number) => ({
      id: `song-${playlist.playlist_id}-${index}`,
      title: `Track ${index + 1}`,
      artist: artist,
      album: playlist.title,
      videoId: videoId,
      thumbnailUrl: generateThumbnailUrl(videoId),
      liked: false,
      played: false,
    })),
  };
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
    const playlists = await readPlaylists();
    
    // Enrich playlists with additional metadata
    const enrichedPlaylists = playlists.map(enrichPlaylist);

    return NextResponse.json(
      {
        success: true,
        playlists: enrichedPlaylists,
        total: enrichedPlaylists.length,
        timestamp: new Date().toISOString(),
      },
      { headers }
    );
  } catch (error) {
    console.error('[MusicHub API] GET error:', error);
    return NextResponse.json(
      {
        success: true,
        playlists: [],
        error: 'Failed to read playlist, returning empty',
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
    const { action, playlist: playlistData, webhookSecret } = body;

    // Validate webhook secret if configured using constant-time comparison
    const expectedSecret = process.env.MUSIC_HUB_WEBHOOK_SECRET;
    if (expectedSecret && (!webhookSecret || !safeCompare(webhookSecret, expectedSecret))) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Invalid webhook secret' },
        { status: 401, headers }
      );
    }

    const playlists = await readPlaylists();

    switch (action) {
      case 'add_playlist': {
        if (!playlistData?.title) {
          return NextResponse.json(
            { success: false, error: 'Playlist title is required' },
            { status: 400, headers }
          );
        }

        // Parse artist from title if not provided
        const { artist } = playlistData.artist
          ? { artist: playlistData.artist }
          : parseArtistAndAlbum(playlistData.title);

        const playlistId = playlistData.playlist_id || 
          playlistData.playlistId || 
          extractPlaylistId(playlistData.link || playlistData.playlistUrl || '');

        // Check for duplicates
        const exists = playlists.some((p: any) => p.playlist_id === playlistId);
        if (exists) {
          return NextResponse.json(
            { success: false, error: 'Playlist already exists' },
            { status: 409, headers }
          );
        }

        const newPlaylist = {
          link: playlistData.link || playlistData.playlistUrl || '',
          playlist_id: playlistId,
          title: playlistData.title,
          discovered_at: playlistData.discovered_at || new Date().toISOString(),
          videos: playlistData.videos || [],
          isNew: true,
          isFeatured: playlistData.isFeatured || false,
          artist: artist,
          coverUrl: playlistData.coverUrl || generateCoverUrl(playlistId, playlistData.title),
        };

        playlists.unshift(newPlaylist);
        break;
      }

      case 'remove_playlist': {
        if (!playlistData?.playlist_id) {
          return NextResponse.json(
            { success: false, error: 'Playlist ID required' },
            { status: 400, headers }
          );
        }

        const playlistIndex = playlists.findIndex((p: any) => p.playlist_id === playlistData.playlist_id);
        if (playlistIndex === -1) {
          return NextResponse.json(
            { success: false, error: 'Playlist not found' },
            { status: 404, headers }
          );
        }

        playlists.splice(playlistIndex, 1);
        break;
      }

      case 'update_playlist': {
        if (!playlistData?.playlist_id) {
          return NextResponse.json(
            { success: false, error: 'Playlist ID required' },
            { status: 400, headers }
          );
        }

        const playlistIndex = playlists.findIndex((p: any) => p.playlist_id === playlistData.playlist_id);
        if (playlistIndex === -1) {
          return NextResponse.json(
            { success: false, error: 'Playlist not found' },
            { status: 404, headers }
          );
        }

        // Update allowed fields
        const existing = playlists[playlistIndex];
        playlists[playlistIndex] = {
          ...existing,
          ...playlistData,
          playlist_id: existing.playlist_id, // Don't allow changing playlist_id
          videos: playlistData.videos !== undefined ? playlistData.videos : existing.videos,
        };
        break;
      }

      case 'add_videos': {
        if (!playlistData?.playlist_id || !playlistData.videos) {
          return NextResponse.json(
            { success: false, error: 'Playlist ID and videos array required' },
            { status: 400, headers }
          );
        }

        const targetPlaylist = playlists.find((p: any) => p.playlist_id === playlistData.playlist_id);
        if (!targetPlaylist) {
          return NextResponse.json(
            { success: false, error: 'Playlist not found' },
            { status: 404, headers }
          );
        }

        // Add new videos that don't already exist
        const existingVideos = new Set(targetPlaylist.videos || []);
        const newVideos = playlistData.videos.filter((v: string) => !existingVideos.has(v));
        targetPlaylist.videos.push(...newVideos);
        break;
      }

      case 'sync_playlist': {
        if (!playlistData?.link && !playlistData?.playlistUrl) {
          return NextResponse.json(
            { success: false, error: 'Playlist URL required' },
            { status: 400, headers }
          );
        }

        const playlistUrl = playlistData.link || playlistData.playlistUrl;
        const playlistId = extractPlaylistId(playlistUrl);

        // Reject if null or clearly a video ID
        if (!playlistId || playlistId.startsWith('_') || playlistId.length < 10) {
          return NextResponse.json(
            { success: false, error: 'Invalid playlist URL. Ensure it contains a valid YouTube playlist ID (e.g., ?list=PL...)' },
            { status: 400, headers }
          );
        }

        // Check if playlist already exists
        const existingIndex = playlists.findIndex((p: any) => p.playlist_id === playlistId);
        if (existingIndex !== -1) {
          // Update existing playlist with sync pending
          playlists[existingIndex].pendingSync = {
            requestedAt: new Date().toISOString(),
            status: 'pending',
          };
        } else {
          // Add new playlist with sync pending
          const newPlaylist: any = {
            link: playlistUrl,
            playlist_id: playlistId,
            title: playlistData.title || 'Unknown Title',
            discovered_at: new Date().toISOString(),
            videos: [],
            pendingSync: {
              requestedAt: new Date().toISOString(),
              status: 'pending',
            },
          };

          // Parse artist from title if available
          if (newPlaylist.title) {
            const { artist } = parseArtistAndAlbum(newPlaylist.title);
            newPlaylist.artist = artist;
          }

          playlists.unshift(newPlaylist);
        }
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400, headers }
        );
    }

    await writePlaylists(playlists);

    return NextResponse.json(
      {
        success: true,
        message: `Action "${action}" completed successfully`,
        playlists: playlists.map(enrichPlaylist),
        total: playlists.length,
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
