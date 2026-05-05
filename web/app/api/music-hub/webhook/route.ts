/**
 * Music Hub Webhook API v2 - Production Ready
 *
 * Features:
 * - Webhook secret validation
 * - Rate limiting
 * - Event logging
 * - Input validation
 * - Error handling
 * 
 * Uses data/playlists.json as the standard storage format
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = 'edge';

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "data");
const PLAYLIST_PATH = join(DATA_DIR, "playlists.json");
const WEBHOOK_LOG_PATH = join(DATA_DIR, "music-hub-webhook-log.json");

// Rate limiting
const RATE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 50, // 50 webhook events per minute
};

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string): { allowed: boolean; remaining: number } {
  const now = Date.now();

  // Prune expired entries to prevent unbounded memory growth
  const entries = Array.from(rateLimitStore.entries());
  for (const [key, value] of entries) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }

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
 * Uses picsum for placeholder images with seeded randomization
 */
function generateCoverUrl(playlistId: string, title: string): string {
  return `https://picsum.photos/seed/${playlistId || title}/400/400`;
}

/**
 * Check if release is recent (within 30 days)
 */
function isRecentRelease(discoveredAt: string): boolean {
  const discovered = new Date(discoveredAt);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - discovered.getTime()) / (1000 * 60 * 60 * 24));
  return daysDiff <= 30;
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
  } catch {
    const defaultPlaylists: any[] = [];
    await writeFile(PLAYLIST_PATH, JSON.stringify(defaultPlaylists, null, 2));
    return defaultPlaylists;
  }
}

/**
 * Write playlists to data/playlists.json
 */
async function writePlaylists(playlists: any[]): Promise<void> {
  await ensureDataDir();
  await writeFile(PLAYLIST_PATH, JSON.stringify(playlists, null, 2));
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

/**
 * Process pending playlist syncs
 * Scans for playlists with pendingSync status and processes them
 */
async function processPendingSyncs(playlists: any[]): Promise<void> {
  const pendingIndex = playlists.findIndex((p: any) => p.pendingSync && p.pendingSync.status === 'pending');
  if (pendingIndex === -1) {
    return;
  }

  const playlist = playlists[pendingIndex];

  try {
    // Update status to in_progress
    playlist.pendingSync.status = 'in_progress';
    playlist.pendingSync.startedAt = new Date().toISOString();
    await writePlaylists(playlists);

    // Note: Actual sync logic should be implemented in a background worker
    // The worker will call YouTube Music API or similar to sync the playlist
    // and update pendingSync.completedAt/status/result when done
    
    console.log('[Webhook] Sync job queued for playlist:', playlist.playlist_id);
  } catch (error) {
    playlist.pendingSync.status = 'failed';
    playlist.pendingSync.failedAt = new Date().toISOString();
    playlist.pendingSync.error = error instanceof Error ? error.message : 'Unknown error';
    await writePlaylists(playlists);

    console.error('[Webhook] Sync failed:', error);
  }
}

// POST - Handle webhook events
export async function POST(request: NextRequest) {
  const clientId = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
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

    const playlists = await readPlaylists();
    let message = '';

    switch (type) {
      case 'new_album': {
        if (!data?.title) {
          return NextResponse.json(
            { success: false, error: 'Album title is required' },
            { status: 400, headers }
          );
        }

        // Parse artist from title if not provided
        const { artist } = data.artist 
          ? { artist: data.artist }
          : parseArtistAndAlbum(data.title);

        const newPlaylist = {
          link: data.link || data.playlistUrl || '',
          playlist_id: data.playlist_id || data.playlistId || extractPlaylistId(data.link || data.playlistUrl || ''),
          title: data.title,
          discovered_at: data.discovered_at || new Date().toISOString(),
          videos: data.videos || data.songs?.map((s: any) => s.videoId) || [],
          isNew: true,
          isFeatured: data.isFeatured || false,
          artist: artist,
          coverUrl: data.coverUrl || generateCoverUrl(data.playlist_id || data.playlistId, data.title),
        };

        playlists.unshift(newPlaylist);
        message = `Added new album: ${newPlaylist.title} by ${artist}`;
        break;
      }

      case 'album_update': {
        if (!data?.playlist_id && !data?.id) {
          return NextResponse.json(
            { success: false, error: 'Playlist ID is required' },
            { status: 400, headers }
          );
        }

        const playlistIndex = playlists.findIndex((p: any) => 
          p.playlist_id === (data.playlist_id || data.id)
        );
        if (playlistIndex === -1) {
          return NextResponse.json(
            { success: false, error: 'Playlist not found' },
            { status: 404, headers }
          );
        }

        // Update fields
        const existing = playlists[playlistIndex];
        playlists[playlistIndex] = {
          ...existing,
          ...data,
          // Normalize field names
          playlist_id: data.playlist_id || data.id || existing.playlist_id,
          title: data.title || existing.title,
          videos: data.videos || existing.videos,
        };
        message = `Updated album: ${playlists[playlistIndex].title}`;
        break;
      }

      case 'album_remove': {
        if (!data?.playlist_id && !data?.id) {
          return NextResponse.json(
            { success: false, error: 'Playlist ID is required' },
            { status: 400, headers }
          );
        }

        const removeIndex = playlists.findIndex((p: any) => 
          p.playlist_id === (data.playlist_id || data.id)
        );
        if (removeIndex === -1) {
          return NextResponse.json(
            { success: false, error: 'Playlist not found' },
            { status: 404, headers }
          );
        }

        const removedPlaylist = playlists.splice(removeIndex, 1)[0];
        message = `Removed album: ${removedPlaylist.title}`;
        break;
      }

      case 'song_add': {
        if (!data?.playlist_id && !data?.albumId) {
          return NextResponse.json(
            { success: false, error: 'Playlist ID is required' },
            { status: 400, headers }
          );
        }

        const targetPlaylist = playlists.find((p: any) => 
          p.playlist_id === (data.playlist_id || data.albumId)
        );
        if (!targetPlaylist) {
          return NextResponse.json(
            { success: false, error: 'Target playlist not found' },
            { status: 404, headers }
          );
        }

        const videoId = data.videoId || data.song?.videoId;
        if (!videoId) {
          return NextResponse.json(
            { success: false, error: 'Video ID is required' },
            { status: 400, headers }
          );
        }

        if (!targetPlaylist.videos.includes(videoId)) {
          targetPlaylist.videos.push(videoId);
        }
        message = `Added video to playlist: ${videoId}`;
        break;
      }

      case 'playlist_sync': {
        const newPlaylist: any = {
          link: data.link || data.playlistUrl || '',
          playlist_id: data.playlist_id || data.playlistId || extractPlaylistId(data.link || data.playlistUrl || ''),
          title: data.title || 'Unknown Title',
          discovered_at: new Date().toISOString(),
          videos: [],
          pendingSync: {
            playlistId: data.playlist_id || data.playlistId,
            requestedAt: new Date().toISOString(),
            status: 'pending',
            source: source || 'n8n',
          },
        };

        // Parse artist from title if available
        if (newPlaylist.title) {
          const { artist } = parseArtistAndAlbum(newPlaylist.title);
          newPlaylist.artist = artist;
        }

        playlists.unshift(newPlaylist);
        message = `Playlist sync initiated for: ${newPlaylist.playlist_id}`;

        // Process the pending sync immediately
        await processPendingSyncs(playlists);
        break;
      }

      case 'refresh_metadata': {
        playlists.forEach((playlist: any) => {
          playlist.isNew = isRecentRelease(playlist.discovered_at);
        });
        message = 'Metadata refreshed';
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown event type: ${type}` },
          { status: 400, headers }
        );
    }

    await writePlaylists(playlists);

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
        playlistCount: playlists.length,
        lastUpdated: new Date().toISOString(),
      },
    }, { headers });
  } catch (err) {
    console.error('[Webhook] Error processing request');

    await logWebhookEvent({
      event: 'error',
      type: 'system_error',
      data: {},
      timestamp: new Date().toISOString(),
      source: 'n8n',
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
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
  } catch {
    return NextResponse.json(
      { error: 'Failed to read webhook logs' },
      { status: 500 }
    );
  }
}

// Helper function to extract YouTube playlist ID
function extractPlaylistId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Playlist IDs are always in the 'list' query parameter for both domains
    if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
      return urlObj.searchParams.get('list');
    }
    return null;
  } catch {
    return null;
  }
}
