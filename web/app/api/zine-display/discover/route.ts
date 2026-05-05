/**
 * RSS Auto-Discovery API for Zine Display
 * 
 * Endpoints:
 * - POST / - Discover RSS feeds from a URL
 * - POST /validate - Validate a specific feed URL
 * - GET /platforms - Get known platform feeds
 * - GET /categories - Get available categories
 */

import { NextRequest, NextResponse } from 'next/server';


import { z } from 'zod';
import { 
  discoverFeedsFromUrl, 
  validateFeed 
} from '@/lib/zine-rss-auto-discovery';
import { sanitizeUrlInput } from '@/lib/utils/sanitize';
import { checkRateLimitMiddleware } from '@/lib/middleware/rate-limit';

// ---------------------------------------------------------------------
// SSRF Protection - Validate URL is safe for server-side fetches
// ---------------------------------------------------------------------

function assertSafeExternalUrl(raw: string): void {
  // First sanitize the input
  let sanitized: string;
  try {
    sanitized = sanitizeUrlInput(raw);
  } catch (error: any) {
    console.error('[Zine-Discover] URL sanitization failed:', error.message);
    throw error;
  }
  const u = new URL(sanitized);
  const host = u.hostname.toLowerCase();

  // Block localhost and loopback addresses
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new Error('Localhost URLs are not allowed');
  }

  // Block link-local addresses
  if (host.startsWith('169.254.') || host.startsWith('fe80:')) {
    throw new Error('Link-local addresses are not allowed');
  }

  // Block private IP ranges
  const privateRanges = [
    /^10\./,                       // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
    /^192\.168\./,                // 192.168.0.0/16
  ];
  if (privateRanges.some(regex => regex.test(host))) {
    throw new Error('Private IP addresses are not allowed');
  }

  // Only allow http and https
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }
}

// ---------------------------------------------------------------------
// POST - Discover RSS feeds from URL
// ---------------------------------------------------------------------

const discoverSchema = z.object({
  url: z.string().url(),
  maxFeeds: z.number().min(1).max(20).optional(),
  validateFeeds: z.boolean().optional(),
  discover: z.boolean().optional().default(true),
});

export async function POST(request: NextRequest) {
  // Rate limiting: 20 requests per minute per IP for the discover endpoint
  // This endpoint makes external HTTP requests so we need stricter limits
  const rateLimitCheck = checkRateLimitMiddleware(request, 'zine-discover', 20, 60000);
  if (rateLimitCheck) {
    return rateLimitCheck;
  }

  try {
    const body = await request.json();
    const { url, maxFeeds = 10, validateFeeds = true, discover = true } = discoverSchema.parse(body);

    // SSRF Protection - validate URL before making any server-side fetches
    assertSafeExternalUrl(url);

    // If not discovering, just validate the single URL
    if (!discover) {
      const validation = await validateFeed(url);
      return NextResponse.json({
        success: validation.valid,
        url,
        validation,
      });
    }

    // Discover feeds from URL
    const feeds = await discoverFeedsFromUrl(url, { 
      maxFeeds, 
      validateFeeds 
    });

    if (feeds.length === 0) {
      // No feeds found - try to validate the URL itself
      const validation = await validateFeed(url);
      return NextResponse.json({
        success: validation.valid,
        url,
        message: validation.valid
          ? 'Input URL is a valid direct feed URL'
          : 'No RSS/Atom feeds found on this page',
        feeds: [],
        directValidation: validation,
      });
    }

    return NextResponse.json({
      success: true,
      url,
      count: feeds.length,
      feeds: feeds.map(f => ({
        url: f.url,
        type: f.type,
        title: f.title,
        categories: f.categories,
        platform: f.platform,
        reliability: f.reliability,
      })),
    });

  } catch (error) {
    console.error('[Zine-Discover] Error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to discover feeds' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// GET - Platform info and categories
// ---------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');

  // List known platform feeds
  if (action === 'platforms') {
    const platforms = [
      { 
        name: 'Hacker News', 
        url: 'https://news.ycombinator.com',
        feeds: ['https://hnrss.org/frontpage', 'https://hnrss.org/newest']
      },
      { 
        name: 'DEV.to', 
        url: 'https://dev.to',
        feeds: ['https://dev.to/feed']
      },
      { 
        name: 'Reddit Programming', 
        url: 'https://reddit.com/r/programming',
        feeds: ['https://www.reddit.com/r/programming/.rss']
      },
      { 
        name: 'TechCrunch', 
        url: 'https://techcrunch.com',
        feeds: ['https://techcrunch.com/feed/']
      },
      { 
        name: 'The Verge', 
        url: 'https://theverge.com',
        feeds: ['https://www.theverge.com/rss/index.xml']
      },
      { 
        name: 'Wired', 
        url: 'https://wired.com',
        feeds: ['https://www.wired.com/feed/rss']
      },
      { 
        name: 'Ars Technica', 
        url: 'https://arstechnica.com',
        feeds: ['https://feeds.arstechnica.com/arstechnica/index']
      },
      { 
        name: 'Product Hunt', 
        url: 'https://producthunt.com',
        feeds: ['https://www.producthunt.com/feed']
      },
    ];

    return NextResponse.json({
      success: true,
      platforms,
    });
  }

  // List available categories
  if (action === 'categories') {
    const categories = [
      { id: 'tech', name: 'Technology', icon: '💻' },
      { id: 'news', name: 'News', icon: '📰' },
      { id: 'dev', name: 'Development', icon: '⚡' },
      { id: 'science', name: 'Science', icon: '🔬' },
      { id: 'security', name: 'Security', icon: '🔒' },
      { id: 'video', name: 'Video', icon: '📺' },
      { id: 'business', name: 'Business', icon: '💼' },
      { id: 'design', name: 'Design', icon: '🎨' },
      { id: 'ai', name: 'AI & ML', icon: '🤖' },
      { id: 'crypto', name: 'Crypto', icon: '₿' },
    ];

    return NextResponse.json({
      success: true,
      categories,
    });
  }

  // Default: return service info
  return NextResponse.json({
    service: 'Zine Display RSS Auto-Discovery',
    version: '1.0.0',
    endpoints: {
      'POST /': 'Discover RSS/Atom feeds from a URL',
      'POST / (discover: false)': 'Validate a single feed URL',
      'GET /?action=platforms': 'List known platform feeds',
      'GET /?action=categories': 'List available categories',
    },
  });
}
