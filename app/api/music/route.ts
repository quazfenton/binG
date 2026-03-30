/**
 * Music Data API
 *
 * Aggregates music data from multiple sources
 * Supports Spotify, Apple Music, and YouTube Music APIs
 */

import { NextRequest, NextResponse } from 'next/server';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  previewUrl?: string;
  source: 'spotify' | 'apple-music' | 'youtube';
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  trackCount: number;
  source: 'spotify' | 'apple-music' | 'youtube';
}

// Sample data (in production, fetch from real APIs)
const SAMPLE_TRACKS: Track[] = [
  {
    id: 'track-1',
    title: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We\'re Dreaming',
    duration: 243,
    coverUrl: 'https://picsum.photos/seed/m83/300/300',
    source: 'spotify',
  },
  {
    id: 'track-2',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
    coverUrl: 'https://picsum.photos/seed/weeknd/300/300',
    source: 'spotify',
  },
  {
    id: 'track-3',
    title: 'Levitating',
    artist: 'Dua Lipa',
    album: 'Future Nostalgia',
    duration: 203,
    coverUrl: 'https://picsum.photos/seed/dualipa/300/300',
    source: 'apple-music',
  },
  {
    id: 'track-4',
    title: 'Stay',
    artist: 'The Kid LAROI & Justin Bieber',
    album: 'F*CK LOVE 3',
    duration: 141,
    coverUrl: 'https://picsum.photos/seed/stay/300/300',
    source: 'youtube',
  },
  {
    id: 'track-5',
    title: 'Good 4 U',
    artist: 'Olivia Rodrigo',
    album: 'SOUR',
    duration: 178,
    coverUrl: 'https://picsum.photos/seed/oliviarodrigo/300/300',
    source: 'spotify',
  },
];

const SAMPLE_PLAYLISTS: Playlist[] = [
  {
    id: 'playlist-1',
    name: 'Today\'s Top Hits',
    description: 'The hottest tracks right now',
    coverUrl: 'https://picsum.photos/seed/tophits/300/300',
    trackCount: 50,
    source: 'spotify',
  },
  {
    id: 'playlist-2',
    name: 'Chill Vibes',
    description: 'Relax and unwind',
    coverUrl: 'https://picsum.photos/seed/chill/300/300',
    trackCount: 75,
    source: 'apple-music',
  },
  {
    id: 'playlist-3',
    name: 'Workout Mix',
    description: 'High energy workout tracks',
    coverUrl: 'https://picsum.photos/seed/workout/300/300',
    trackCount: 40,
    source: 'spotify',
  },
];

/**
 * GET /api/music/tracks - Get trending tracks
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'tracks';
    const source = searchParams.get('source');
    const search = searchParams.get('search');

    if (type === 'playlists') {
      let playlists = [...SAMPLE_PLAYLISTS];

      if (source) {
        playlists = playlists.filter(p => p.source === source);
      }

      if (search) {
        const searchLower = search.toLowerCase();
        playlists = playlists.filter(p =>
          p.name.toLowerCase().includes(searchLower) ||
          p.description.toLowerCase().includes(searchLower)
        );
      }

      return NextResponse.json({
        success: true,
        playlists,
        total: playlists.length,
      });
    }

    // Default: return tracks
    let tracks = [...SAMPLE_TRACKS];

    if (source) {
      tracks = tracks.filter(t => t.source === source);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      tracks = tracks.filter(t =>
        t.title.toLowerCase().includes(searchLower) ||
        t.artist.toLowerCase().includes(searchLower)
      );
    }

    return NextResponse.json({
      success: true,
      tracks,
      total: tracks.length,
      sources: ['spotify', 'apple-music', 'youtube'],
    });
  } catch (error: any) {
    console.error('[Music API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load music data' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/music/search - Search tracks/playlists
 */
export async function GETSearch(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query) {
      return NextResponse.json(
        { error: 'Search query required' },
        { status: 400 }
      );
    }

    // In production, search real APIs
    const searchLower = query.toLowerCase();
    
    const matchingTracks = SAMPLE_TRACKS.filter(t =>
      t.title.toLowerCase().includes(searchLower) ||
      t.artist.toLowerCase().includes(searchLower)
    );

    const matchingPlaylists = SAMPLE_PLAYLISTS.filter(p =>
      p.name.toLowerCase().includes(searchLower) ||
      p.description.toLowerCase().includes(searchLower)
    );

    return NextResponse.json({
      success: true,
      tracks: matchingTracks,
      playlists: matchingPlaylists,
      total: matchingTracks.length + matchingPlaylists.length,
    });
  } catch (error: any) {
    console.error('[Music API] Search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
