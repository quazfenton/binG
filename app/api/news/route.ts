/**
 * News Aggregation API
 *
 * Fetches tech news from multiple RSS feeds and APIs
 * Provides unified news feed for the News tab
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseRSSFeed, type NewsArticle } from '@/lib/news/rss-parser';

// Image proxy helper
function proxyImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

// RSS feed sources
const RSS_FEEDS = [
  {
    id: 'techcrunch',
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    category: 'AI',
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/rss',
    category: 'Development',
  },
  {
    id: 'theverge',
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    category: 'AI',
  },
  {
    id: 'wired',
    name: 'Wired',
    url: 'https://www.wired.com/feed/rss',
    category: 'Development',
  },
  {
    id: 'arstechnica',
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    category: 'Development',
  },
  {
    id: 'venturebeat',
    name: 'VentureBeat',
    url: 'https://venturebeat.com/feed/',
    category: 'AI',
  },
];

// Fallback news data (used when RSS feeds fail)
const FALLBACK_NEWS: NewsArticle[] = [
  {
    id: 'fallback-1',
    title: 'AI Breakthrough: New Model Achieves Human-Level Reasoning',
    summary: 'Researchers announce major advancement in artificial general intelligence with new architecture...',
    url: 'https://techcrunch.com',
    source: 'TechCrunch',
    category: 'AI',
    publishedAt: new Date(Date.now() - 7200000),
    imageUrl: '/api/image-proxy?url=' + encodeURIComponent('https://picsum.photos/seed/ai1/400/300'),
  },
  {
    id: 'fallback-2',
    title: 'Next.js 15 Released with Revolutionary Features',
    summary: 'The latest version brings server actions, partial prerendering, and improved performance...',
    url: 'https://vercel.com',
    source: 'Vercel',
    category: 'Development',
    publishedAt: new Date(Date.now() - 14400000),
    imageUrl: '/api/image-proxy?url=' + encodeURIComponent('https://picsum.photos/seed/nextjs/400/300'),
  },
  {
    id: 'fallback-3',
    title: 'Open Source AI Models Surpass Proprietary Counterparts',
    summary: 'Community-driven models now match or exceed closed-source alternatives in benchmarks...',
    url: 'https://news.ycombinator.com',
    source: 'Hacker News',
    category: 'AI',
    publishedAt: new Date(Date.now() - 21600000),
    imageUrl: '/api/image-proxy?url=' + encodeURIComponent('https://picsum.photos/seed/opensource/400/300'),
  },
  {
    id: 'fallback-4',
    title: 'Web Assembly Performance Reaches New Heights',
    summary: 'Latest benchmarks show WASM approaching native performance levels across browsers...',
    url: 'https://wired.com',
    source: 'Wired',
    category: 'Development',
    publishedAt: new Date(Date.now() - 28800000),
    imageUrl: '/api/image-proxy?url=' + encodeURIComponent('https://picsum.photos/seed/wasm/400/300'),
  },
  {
    id: 'fallback-5',
    title: 'The Future of Full-Stack Development in 2026',
    summary: 'Industry experts share predictions on where web development is heading this year...',
    url: 'https://theverge.com',
    source: 'The Verge',
    category: 'Development',
    publishedAt: new Date(Date.now() - 36000000),
    imageUrl: '/api/image-proxy?url=' + encodeURIComponent('https://picsum.photos/seed/fullstack/400/300'),
  },
  {
    id: 'fallback-6',
    title: 'Quantum Computing Milestone Achieved by IBM',
    summary: 'New quantum processor breaks previous records with 1000+ qubits...',
    url: 'https://arstechnica.com',
    source: 'Ars Technica',
    category: 'AI',
    publishedAt: new Date(Date.now() - 43200000),
    imageUrl: '/api/image-proxy?url=' + encodeURIComponent('https://picsum.photos/seed/quantum/400/300'),
  },
];

// Validate RSS feed URLs on startup
RSS_FEEDS.forEach(feed => {
  try {
    new URL(feed.url);
  } catch (error) {
    console.error(`[News API] Invalid RSS feed URL for ${feed.name}:`, feed.url);
  }
});

// Cache for RSS feeds (5 minute TTL)
const feedCache = new Map<string, { articles: NewsArticle[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/news - Fetch aggregated news
 *
 * Query parameters:
 * - limit: Max articles to return (default: 30)
 * - category: Filter by category (AI, Development, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '30');
    const category = searchParams.get('category');

    // Fetch from all feeds in parallel with timeout
    const feedPromises = RSS_FEEDS.map(async (feed) => {
      // Check cache first
      const cached = feedCache.get(feed.id);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.articles;
      }

      // Fetch fresh with timeout
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const articles = await parseRSSFeed(feed.url);
        clearTimeout(timeoutId);

        // Add source metadata and proxy images
        const enriched = articles.slice(0, 10).map(article => ({
          ...article,
          source: feed.name,
          category: feed.category,
          imageUrl: proxyImageUrl(article.imageUrl),
        }));

        // Cache the result
        feedCache.set(feed.id, {
          articles: enriched,
          timestamp: Date.now(),
        });

        return enriched;
      } catch (feedError: any) {
        console.warn(`[News API] Feed ${feed.name} failed:`, feedError.message);
        return [];
      }
    });

    const results = await Promise.all(feedPromises);

    // Flatten results
    let allArticles = results.flat();

    // If no articles from RSS, use fallback
    if (allArticles.length === 0) {
      console.log('[News API] Using fallback news data');
      allArticles = FALLBACK_NEWS.map(article => ({
        ...article,
        publishedAt: new Date(article.publishedAt),
      }));
    }

    // Proxy images for all articles (only if not already proxied)
    allArticles = allArticles.map(article => ({
      ...article,
      imageUrl: article.imageUrl?.startsWith('/api/image-proxy?url=') 
        ? article.imageUrl 
        : proxyImageUrl(article.imageUrl),
    }));

    // Sort by date (newest first)
    allArticles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    // Filter by category if specified
    if (category) {
      allArticles = allArticles.filter(article =>
        article.category?.toLowerCase() === category.toLowerCase()
      );
    }

    // Apply limit
    const limited = allArticles.slice(0, limit);

    return NextResponse.json({
      success: true,
      articles: limited,
      total: limited.length,
      sources: RSS_FEEDS.map(f => f.name),
      usingFallback: allArticles.length === FALLBACK_NEWS.length,
    });
  } catch (error: any) {
    console.error('[News API] Error:', error);

    // Return fallback data on error
    return NextResponse.json({
      success: true,
      articles: FALLBACK_NEWS.slice(0, 30),
      total: FALLBACK_NEWS.length,
      sources: ['Fallback'],
      usingFallback: true,
    });
  }
}

/**
 * POST /api/news/clear-cache - Clear news cache
 * (Admin-only endpoint)
 */
export async function POST(request: NextRequest) {
  try {
    // Fail closed when NEWS_API_SECRET is missing
    const secret = process.env.NEWS_API_SECRET;
    if (!secret) {
      console.error('[News API] NEWS_API_SECRET is not configured');
      return NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    feedCache.clear();

    return NextResponse.json({
      success: true,
      message: 'News cache cleared',
    });
  } catch (error: any) {
    console.error('[News API] Cache clear error:', error);
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}
