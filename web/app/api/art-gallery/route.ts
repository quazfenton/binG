/**
 * AI Art Gallery API
 *
 * Curated AI-generated artwork from various sources
 * Supports filtering, search, and favorites
 */

import { NextRequest, NextResponse } from 'next/server';

export interface Artwork {
  id: string;
  title: string;
  artist: string;
  imageUrl: string;
  style: string;
  prompt?: string;
  model: string;
  likes: number;
  views: number;
  createdAt: number;
  tags: string[];
}

// Curated gallery of AI artwork (in production, this would come from a database)
const ARTWORKS: Artwork[] = [
  {
    id: 'art-1',
    title: 'Cyberpunk Cityscape',
    artist: 'AI Artist',
    imageUrl: 'https://picsum.photos/seed/cyberpunk/800/600',
    style: 'Cyberpunk',
    prompt: 'Futuristic cyberpunk city at night with neon lights',
    model: 'Midjourney v5',
    likes: 234,
    views: 1567,
    createdAt: Date.now() - 86400000 * 5,
    tags: ['cyberpunk', 'city', 'neon', 'futuristic'],
  },
  {
    id: 'art-2',
    title: 'Abstract Dreams',
    artist: 'AI Artist',
    imageUrl: 'https://picsum.photos/seed/abstract/800/600',
    style: 'Abstract',
    prompt: 'Colorful abstract flowing patterns',
    model: 'DALL-E 3',
    likes: 189,
    views: 1234,
    createdAt: Date.now() - 86400000 * 7,
    tags: ['abstract', 'colorful', 'patterns'],
  },
  {
    id: 'art-3',
    title: 'Fantasy Landscape',
    artist: 'AI Artist',
    imageUrl: 'https://picsum.photos/seed/fantasy/800/600',
    style: 'Fantasy',
    prompt: 'Magical fantasy landscape with floating islands',
    model: 'Stable Diffusion XL',
    likes: 312,
    views: 2103,
    createdAt: Date.now() - 86400000 * 10,
    tags: ['fantasy', 'landscape', 'magical'],
  },
  {
    id: 'art-4',
    title: 'Portrait Study',
    artist: 'AI Artist',
    imageUrl: 'https://picsum.photos/seed/portrait/800/600',
    style: 'Realistic',
    prompt: 'Photorealistic portrait with dramatic lighting',
    model: 'Midjourney v5',
    likes: 278,
    views: 1890,
    createdAt: Date.now() - 86400000 * 14,
    tags: ['portrait', 'realistic', 'dramatic'],
  },
  {
    id: 'art-5',
    title: 'Space Exploration',
    artist: 'AI Artist',
    imageUrl: 'https://picsum.photos/seed/space/800/600',
    style: 'Sci-Fi',
    prompt: 'Deep space nebula with planets and stars',
    model: 'DALL-E 3',
    likes: 401,
    views: 2567,
    createdAt: Date.now() - 86400000 * 20,
    tags: ['space', 'nebula', 'sci-fi'],
  },
  {
    id: 'art-6',
    title: 'Nature Harmony',
    artist: 'AI Artist',
    imageUrl: 'https://picsum.photos/seed/nature/800/600',
    style: 'Realistic',
    prompt: 'Serene forest landscape with morning mist',
    model: 'Stable Diffusion XL',
    likes: 356,
    views: 2234,
    createdAt: Date.now() - 86400000 * 25,
    tags: ['nature', 'forest', 'serene'],
  },
];

const STYLES = ['All', 'Cyberpunk', 'Abstract', 'Fantasy', 'Realistic', 'Sci-Fi', 'Minimalist'];

/**
 * GET /api/art-gallery - List artworks
 * 
 * Query parameters:
 * - style: Filter by style
 * - search: Search in title/tags
 * - sort: Sort by 'likes', 'views', 'recent' (default: recent)
 * - limit: Max results (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const style = searchParams.get('style');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') || 'recent';
    const limit = parseInt(searchParams.get('limit') || '50');

    let artworks = [...ARTWORKS];

    // Filter by style
    if (style && style !== 'All') {
      artworks = artworks.filter(a => a.style === style);
    }

    // Search in title and tags
    if (search) {
      const searchLower = search.toLowerCase();
      artworks = artworks.filter(a =>
        a.title.toLowerCase().includes(searchLower) ||
        a.tags.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }

    // Sort
    artworks.sort((a, b) => {
      switch (sort) {
        case 'likes':
          return b.likes - a.likes;
        case 'views':
          return b.views - a.views;
        case 'recent':
        default:
          return b.createdAt - a.createdAt;
      }
    });

    // Apply limit
    artworks = artworks.slice(0, limit);

    return NextResponse.json({
      success: true,
      artworks,
      total: artworks.length,
      styles: STYLES,
    });
  } catch (error: any) {
    console.error('[Art Gallery API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load artworks' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/art-gallery - Like artwork
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action } = body;

    if (!id || !action) {
      return NextResponse.json(
        { error: 'Artwork ID and action are required' },
        { status: 400 }
      );
    }

    // In production, update database
    // For now, just return success
    return NextResponse.json({
      success: true,
      message: `Artwork ${action}ed`,
    });
  } catch (error: any) {
    console.error('[Art Gallery API] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update artwork' },
      { status: 500 }
    );
  }
}
