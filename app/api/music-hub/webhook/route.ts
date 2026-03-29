/**
 * Music Hub Webhook API v2 - Production Ready
 *
 * Features:
 * - Webhook secret validation
 * - Rate limiting
 * - Event logging
 * - Input validation
 * - Error handling
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "data");
const PLAYLIST_PATH = join(DATA_DIR, "music-hub-playlist.json");
const WEBHOOK_LOG_PATH = join(DATA_DIR, "music-hub-webhook-log.json");

// Rate limiting
const RATE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 50, // 50 webhook events per minute
};

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(identifier, { count: 1, resetTime: now + RATE_LIMIT.windowMs });
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
  }

  if (record.count >= RATE_LIMIT.maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT.maxRequests - record.count };
}

// Ensure data directory
async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// Read playlist
async function readPlaylist(): Promise<any> {
  try {
    await ensureDataDir();
    const data = await readFile(PLAYLIST_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    const defaultPlaylist = { albums: [], lastUpdated: new Date().toISOString(), autoUpdate: true };
    await writeFile(PLAYLIST_PATH, JSON.stringify(defaultPlaylist, null, 2));
    return defaultPlaylist;
  }
}

// Write playlist
async function writePlaylist(playlist: any): Promise<void> {
  await ensureDataDir();
  await writeFile(PLAYLIST_PATH, JSON.stringify(playlist, null, 2));
}

// Log webhook event
async function logWebhookEvent(event: any): Promise<void> {
  try {
    await ensureDataDir();
    let logs = { events: [] };
    
    try {
      const data = await readFile(WEBHOOK_LOG_PATH, "utf-8");
      logs = JSON.parse(data);
    } catch {
      // File doesn't exist
    }

    logs.events.unshift({
      ...event,
      loggedAt: new Date().toISOString(),
    });

    // Keep only last 100 events
    logs.events = logs.events.slice(0, 100);
    await writeFile(WEBHOOK_LOG_PATH, JSON.stringify(logs, null, 2));
  } catch (error) {
    console.error('[Webhook] Log error:', error);
  }
}

// POST - Handle webhook events
export async function POST(request: NextRequest) {
  const clientId = request.headers.get('x-forwarded-for') || request.ip || 'unknown';
  const rateLimit = checkRateLimit(`webhook:${clientId}`);

  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers }
    );
  }

  try {
    const body = await request.json();
    const { event, type, data, timestamp, source } = body;

    // Validate required fields
    if (!event || !type) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: event, type' },
        { status: 400, headers }
      );
    }

    // Validate webhook secret if configured
    const expectedSecret = process.env.MUSIC_HUB_WEBHOOK_SECRET;
    const providedSecret = request.headers.get('x-webhook-secret');
    
    if (expectedSecret && providedSecret !== expectedSecret) {
      const error = { success: false, error: 'Unauthorized: Invalid webhook secret' };
      await logWebhookEvent({ ...body, success: false, error: error.error });
      return NextResponse.json(error, { status: 401, headers });
    }

    const playlist = await readPlaylist();
    let message = '';

    switch (type) {
      case 'new_album': {
        if (!data?.title) {
          return NextResponse.json(
            { success: false, error: 'Album title is required' },
            { status: 400, headers }
          );
        }

        const newAlbum = {
          id: data.id || `album-${Date.now()}`,
          title: data.title,
          artist: data.artist || 'Unknown Artist',
          releaseDate: data.releaseDate || new Date().toISOString().split('T')[0],
          playlistUrl: data.playlistUrl || '',
          playlistId: extractPlaylistId(data.playlistUrl || ''),
          coverUrl: data.coverUrl || `https://picsum.photos/seed/${Date.now()}/400/400`,
          isNew: true,
          isFeatured: data.isFeatured || false,
          songs: data.songs || [],
          addedAt: new Date().toISOString(),
        };

        playlist.albums.unshift(newAlbum);
        message = `Added new album: ${newAlbum.title}`;
        break;
      }

      case 'album_update': {
        if (!data?.id) {
          return NextResponse.json(
            { success: false, error: 'Album ID is required' },
            { status: 400, headers }
          );
        }

        const albumIndex = playlist.albums.findIndex((a: any) => a.id === data.id);
        if (albumIndex === -1) {
          return NextResponse.json(
            { success: false, error: 'Album not found' },
            { status: 404, headers }
          );
        }

        playlist.albums[albumIndex] = {
          ...playlist.albums[albumIndex],
          ...data,
          lastUpdated: new Date().toISOString(),
        };
        message = `Updated album: ${playlist.albums[albumIndex].title}`;
        break;
      }

      case 'album_remove': {
        if (!data?.id) {
          return NextResponse.json(
            { success: false, error: 'Album ID is required' },
            { status: 400, headers }
          );
        }

        const removeIndex = playlist.albums.findIndex((a: any) => a.id === data.id);
        if (removeIndex === -1) {
          return NextResponse.json(
            { success: false, error: 'Album not found' },
            { status: 404, headers }
          );
        }

        const removedAlbum = playlist.albums.splice(removeIndex, 1)[0];
        message = `Removed album: ${removedAlbum.title}`;
        break;
      }

      case 'song_add': {
        if (!data?.albumId || !data?.song?.title) {
          return NextResponse.json(
            { success: false, error: 'Album ID and song title are required' },
            { status: 400, headers }
          );
        }

        const targetAlbum = playlist.albums.find((a: any) => a.id === data.albumId);
        if (!targetAlbum) {
          return NextResponse.json(
            { success: false, error: 'Target album not found' },
            { status: 404, headers }
          );
        }

        const newSong = {
          id: data.song.id || `song-${Date.now()}`,
          title: data.song.title,
          artist: data.song.artist || targetAlbum.artist,
          album: targetAlbum.title,
          videoId: data.song.videoId,
          duration: data.song.duration || 180,
          thumbnailUrl: `https://img.youtube.com/vi/${data.song.videoId}/maxresdefault.jpg`,
          liked: false,
          played: false,
        };

        targetAlbum.songs.push(newSong);
        message = `Added song: ${newSong.title}`;
        break;
      }

      case 'playlist_sync': {
        playlist.pendingSync = {
          playlistId: data.playlistId,
          requestedAt: new Date().toISOString(),
          status: 'pending',
          source: source || 'n8n',
        };
        message = `Playlist sync initiated for: ${data.playlistId}`;
        break;
      }

      case 'refresh_metadata': {
        playlist.lastRefreshed = new Date().toISOString();
        playlist.albums = playlist.albums.map((album: any) => ({
          ...album,
          isNew: isRecentRelease(album.releaseDate),
        }));
        message = 'Metadata refreshed';
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown event type: ${type}` },
          { status: 400, headers }
        );
    }

    playlist.lastUpdated = new Date().toISOString();
    await writePlaylist(playlist);

    await logWebhookEvent({
      event,
      type,
      data,
      timestamp: timestamp || new Date().toISOString(),
      source: source || 'n8n',
      success: true,
      message,
    });

    return NextResponse.json({
      success: true,
      message,
      playlist: {
        albumCount: playlist.albums.length,
        lastUpdated: playlist.lastUpdated,
      },
    }, { headers });
  } catch (error) {
    console.error('[Webhook] Error:', error);

    await logWebhookEvent({
      event: 'error',
      type: 'system_error',
      data: {},
      timestamp: new Date().toISOString(),
      source: 'n8n',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process webhook',
      },
      { status: 500, headers }
    );
  }
}

// GET - Retrieve webhook logs
export async function GET() {
  try {
    await ensureDataDir();
    let logs = { events: [] };
    
    try {
      const data = await readFile(WEBHOOK_LOG_PATH, "utf-8");
      logs = JSON.parse(data);
    } catch {
      return NextResponse.json({ success: true, events: [] });
    }

    return NextResponse.json({
      success: true,
      events: logs.events,
      totalEvents: logs.events.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read webhook logs' },
      { status: 500 }
    );
  }
}

// Helper functions
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

function isRecentRelease(releaseDate: string): boolean {
  const release = new Date(releaseDate);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - release.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff <= 30;
}
