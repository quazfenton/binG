/**
 * Music Data API
 *
 * Aggregates music data from multiple sources
 * Supports Spotify, Apple Music, and YouTube Music APIs
 */

import { NextRequest, NextResponse } from 'next/server';



interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  previewUrl?: string;
  source: 'spotify' | 'apple-music' | 'youtube';
}

interface Playlist {
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
    const type = searchParams.get('type');
    const source = searchParams.get('source');
    const search = searchParams.get('search');

    // Validate type parameter
    const validTypes = ['tracks', 'playlists'];
    if (type && !validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type parameter. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate source parameter
    const validSources = ['spotify', 'apple-music', 'youtube'];
    if (source && !validSources.includes(source)) {
      return NextResponse.json(
        { error: `Invalid source parameter. Must be one of: ${validSources.join(', ')}` },
        { status: 400 }
      );
    }

    const resolvedType = type || 'tracks';

    if (resolvedType === 'playlists') {
      let playlists = [...SAMPLE_PLAYLISTS];

      // Filter by source (case-insensitive)
      if (source) {
        const normalizedSource = source.toLowerCase();
        playlists = playlists.filter(p => p.source.toLowerCase() === normalizedSource);
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

    // Filter by source (case-insensitive)
    if (source) {
      const normalizedSource = source.toLowerCase();
      tracks = tracks.filter(t => t.source.toLowerCase() === normalizedSource);
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
      sources: validSources,
      types: validTypes,
    });
  } catch (error: any) {
    console.error('[Music API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load music data' },
      { status: 500 }
    );
  }
}
