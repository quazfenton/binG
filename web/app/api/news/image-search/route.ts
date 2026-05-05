import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { z } from 'zod';

// Image search API - uses multiple strategies to find relevant images

// DuckDuckGo API (no API key required)
const DDG_API = 'https://api.duckduckgo.com/';

// Search for images using topic/keywords
async function searchImages(query: string): Promise<string[]> {
  const images: string[] = [];
  
  try {
    // Use DuckDuckGo Instant Answer API to get related images
    const url = `${DDG_API}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'binG-News-Panel/1.0 (Image Search)',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      return images;
    }
    
    const data = await response.json();
    
    // Extract image from RelatedTopics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (topic.Icon && topic.Icon.URL) {
          // Filter out small icons, get larger images
          if (topic.Icon.URL.includes('media.') || topic.Icon.URL.includes('images.')) {
            images.push(topic.Icon.URL);
          }
        }
      }
    }
    
    // Also check for Image from the main response
    if (data.Image && data.Image.startsWith('http')) {
      images.unshift(data.Image);
    }
    
  } catch (error) {
    console.error('[ImageSearch] DuckDuckGo error:', error);
  }
  
  // Fallback: Use a simple image service with the query as seed
  // This provides consistent placeholder images based on topic
  if (images.length === 0) {
    // Generate a deterministic placeholder URL using picsum with topic-based seed
    const seed = query.split(' ').slice(0, 2).join('');
    const hash = seed.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
    const imageId = Math.abs(hash) % 1000;
    
    // Use picsum for reliable fallback images
    images.push(`https://picsum.photos/seed/${imageId}/400/250`);
    images.push(`https://picsum.photos/seed/${hash % 1000}/400/250`);
  }
  
  return images.slice(0, 5);
}

// Extract keywords from article title for image search
function extractKeywords(title: string): string {
  // Remove common words and keep meaningful keywords
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their'];
  
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .slice(0, 5);
  
  return words.join(' ');
}

// GET handler - search for images based on article title/topic
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || searchParams.get('query');
  
  if (!query || query.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'Query parameter required' },
      { status: 400 }
    );
  }
  
  const keywords = extractKeywords(query);
  const images = await searchImages(keywords);
  
  return NextResponse.json({
    success: true,
    query: keywords,
    images,
    count: images.length,
  });
}

// POST handler - batch search for multiple articles
export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (jsonError: any) {
      console.warn('[ImageSearch] Invalid JSON:', jsonError.message);
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    console.log('[ImageSearch] Received request:', JSON.stringify(body, null, 2).slice(0, 500));

    const schema = z.object({
      articles: z.array(z.object({
        id: z.string(),
        title: z.string(),
      })).min(1).max(50),
    });

    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
      console.warn('[ImageSearch] Validation error:', parseResult.error.errors);
      return NextResponse.json(
        { 
          success: false, 
          error: parseResult.error.errors[0]?.message || 'Invalid request format',
          received: Object.keys(body || {}),
          articlesCount: Array.isArray(body?.articles) ? body.articles.length : 'not-an-array',
        },
        { status: 400 }
      );
    }

    const { articles } = parseResult.data;
    console.log('[ImageSearch] Processing', articles.length, 'articles');

    // Search images for each article
    const results = await Promise.all(
      articles.map(async (article) => {
        const keywords = extractKeywords(article.title);
        const images = await searchImages(keywords);
        return {
          id: article.id,
          images,
        };
      })
    );

    console.log('[ImageSearch] Found images for', results.length, 'articles');

    return NextResponse.json({
      success: true,
      results,
    });

  } catch (error: any) {
    console.error('[ImageSearch] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to search images' },
      { status: 500 }
    );
  }
}
