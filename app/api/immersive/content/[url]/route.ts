/**
 * Immersive View Content API v2 - Production Ready
 *
 * Features:
 * - Rate limiting
 * - URL validation and security
 * - Content caching with TTL
 * - Error handling
 * - Graceful degradation
 * - Request timeout
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "data");
const CACHE_PATH = join(DATA_DIR, "immersive-content-cache.json");

// Configuration
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 500;
const REQUEST_TIMEOUT = 10000; // 10 seconds
const RATE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 20, // 20 requests per minute
};

// Allowed protocols
const ALLOWED_PROTOCOLS = ['https:', 'http:'];

// Blocked domains/patterns
const BLOCKED_PATTERNS = [
  /localhost/i,
  /127\.0\.0\.1/i,
  /0\.0\.0\.0/i,
  /\.internal$/i,
  /\.local$/i,
  /192\.168\./i,
  /10\./i,
  /172\.(1[6-9]|2[0-9]|3[01])\./i,
];

// Rate limit store
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

interface ContentCache {
  [url: string]: {
    content: ExtractedContent;
    timestamp: number;
    accessCount: number;
  };
}

interface ExtractedContent {
  url: string;
  title: string;
  description: string;
  images: Array<{ src: string; alt: string }>;
  videos: Array<{ src: string; type: string }>;
  links: Array<{ href: string; text: string }>;
  text: string;
  contentType: string;
  favicon?: string;
}

// Check rate limit
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

// Validate URL
function validateUrl(input: string): { valid: boolean; url?: string; error?: string } {
  if (!input || input.trim().length === 0) {
    return { valid: false, error: 'URL is required' };
  }

  let urlToValidate = input.trim();
  if (!urlToValidate.startsWith('http://') && !urlToValidate.startsWith('https://')) {
    urlToValidate = `https://${urlToValidate}`;
  }

  try {
    const url = new URL(urlToValidate);

    if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS URLs are allowed' };
    }

    const hostname = url.hostname.toLowerCase();
    if (BLOCKED_PATTERNS.some(pattern => pattern.test(hostname))) {
      return { valid: false, error: 'Access to local/internal addresses is blocked for security' };
    }

    return { valid: true, url: url.href };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// Ensure data directory
async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// Read cache
async function readCache(): Promise<ContentCache> {
  try {
    await ensureDataDir();
    const data = await readFile(CACHE_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Write cache
async function writeCache(cache: ContentCache): Promise<void> {
  await ensureDataDir();
  
  // Evict old entries if cache is full
  const entries = Object.entries(cache);
  if (entries.length > MAX_CACHE_SIZE) {
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    toDelete.forEach(([key]) => delete cache[key]);
  }
  
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// Get cached content
async function getCachedContent(url: string): Promise<ExtractedContent | null> {
  try {
    const cache = await readCache();
    const cached = cache[url];
    
    if (!cached) return null;
    
    // Check if expired
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      delete cache[url];
      await writeCache(cache);
      return null;
    }
    
    cached.accessCount++;
    await writeCache(cache);
    
    return cached.content;
  } catch {
    return null;
  }
}

// Cache content
async function cacheContent(url: string, content: ExtractedContent): Promise<void> {
  try {
    const cache = await readCache();
    
    cache[url] = {
      content,
      timestamp: Date.now(),
      accessCount: 1,
    };
    
    await writeCache(cache);
  } catch (error) {
    console.error('[Immersive API] Cache error:', error);
  }
}

// Extract title from HTML
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : 'Untitled';
}

// Extract description from HTML
function extractDescription(html: string): string {
  const match = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i
  ) || html.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i
  );
  return match ? match[1].trim() : '';
}

// Extract images from HTML
function extractImages(html: string, baseUrl: string): Array<{ src: string; alt: string }> {
  const images: Array<{ src: string; alt: string }> = [];
  const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    try {
      const src = new URL(match[1], baseUrl).href;
      if (src.startsWith('http') && !src.includes('data:')) {
        images.push({ src, alt: match[2] || '' });
      }
    } catch {
      // Skip invalid URLs
    }
  }

  return images.slice(0, 50);
}

// Extract text from HTML
function extractText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

// GET - Fetch and parse content
export async function GET(
  request: NextRequest,
  { params }: { params: { url: string } }
) {
  const clientId = request.headers.get('x-forwarded-for') || request.ip || 'unknown';
  const rateLimit = checkRateLimit(`content:${clientId}`);

  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'Cache-Control': 'public, max-age=3600',
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers }
    );
  }

  const { url } = params;
  const searchParams = request.nextUrl.searchParams;
  const useCache = searchParams.get('cache') !== 'false';
  const parse = searchParams.get('parse') === 'true';

  // Validate URL
  const decodedUrl = decodeURIComponent(url);
  const validation = validateUrl(decodedUrl);

  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400, headers }
    );
  }

  const finalUrl = validation.url!;

  // Try cache first
  if (useCache && parse) {
    const cached = await getCachedContent(finalUrl);
    if (cached) {
      return NextResponse.json({
        success: true,
        cached: true,
        content: cached,
      }, { headers });
    }
  }

  // Fetch content
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(finalUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ImmersiveView/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const html = await response.text();

    // If not parsing, return raw HTML
    if (!parse) {
      return new NextResponse(html, {
        headers: {
          'Content-Type': contentType || 'text/html',
          ...headers,
        },
      });
    }

    // Parse content
    const parsed: ExtractedContent = {
      url: finalUrl,
      title: extractTitle(html),
      description: extractDescription(html),
      images: extractImages(html, finalUrl),
      videos: [],
      links: [],
      text: extractText(html),
      contentType,
    };

    // Cache the result
    if (useCache) {
      await cacheContent(finalUrl, parsed);
    }

    return NextResponse.json({
      success: true,
      cached: false,
      content: parsed,
    }, { headers });
  } catch (error) {
    console.error('[Immersive API] Fetch error:', error);
    
    // Return graceful degradation
    const urlObj = new URL(finalUrl);
    const fallbackContent: ExtractedContent = {
      url: finalUrl,
      title: urlObj.hostname,
      description: 'Content could not be fetched. The site may block external requests.',
      images: [],
      videos: [],
      links: [],
      text: '',
      contentType: 'unknown',
    };

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch content',
      content: fallbackContent,
    }, { status: 500, headers });
  }
}

// DELETE - Clear cache
export async function DELETE(
  request: NextRequest,
  { params }: { params: { url: string } }
) {
  const { url } = params;
  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
  };

  try {
    const cache = await readCache();
    
    if (url === 'all') {
      await writeCache({});
      return NextResponse.json({ success: true, message: 'Cache cleared' }, { headers });
    }

    const decodedUrl = decodeURIComponent(url);
    delete cache[decodedUrl];
    await writeCache(cache);

    return NextResponse.json({
      success: true,
      message: `Cache cleared for ${decodedUrl}`,
    }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500, headers }
    );
  }
}
