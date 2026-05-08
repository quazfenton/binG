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


import { auth0 } from "@/lib/auth0";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { isHostnameBlocked } from "@/lib/utils/url-validation";

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
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB limit

// Allowed protocols
const ALLOWED_PROTOCOLS = ['https:', 'http:'];

// Maximum redirect hops to prevent redirect loops
const MAX_REDIRECT_HOPS = 5;

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
  
  // Prune expired entries to prevent unbounded memory growth
  for (const [key, value] of rateLimitStore) {
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

// Validate URL with SSRF protection
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

    // Use shared SSRF validator
    if (isHostnameBlocked(url.hostname)) {
      return { valid: false, error: 'Access to local/internal addresses is blocked for security' };
    }

    return { valid: true, url: url.href };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

// Validate redirect URL to prevent SSRF via redirect
function validateRedirectUrl(currentUrl: string, redirectUrl: string): { valid: boolean; url?: string; error?: string } {
  try {
    // Resolve relative URLs against current URL
    const resolved = new URL(redirectUrl, currentUrl);

    if (!ALLOWED_PROTOCOLS.includes(resolved.protocol)) {
      return { valid: false, error: 'Redirect to non-HTTP(S) URL blocked' };
    }

    // Use shared SSRF validator
    if (isHostnameBlocked(resolved.hostname)) {
      return { valid: false, error: 'Redirect to local/internal address blocked' };
    }

    return { valid: true, url: resolved.href };
  } catch {
    return { valid: false, error: 'Invalid redirect URL' };
  }
}

/**
 * Read response body with size limit to prevent OOM
 */
async function readResponseWithLimit(response: Response, maxSize: number): Promise<string> {
  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;
      if (totalBytes > maxSize) {
        throw new Error(`Response size exceeds limit (${maxSize} bytes)`);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Concatenate chunks and decode
  const concatenated = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    concatenated.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder('utf-8').decode(concatenated);
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
  { params }: { params: Promise<{ url: string }> }
) {
  // Use x-forwarded-for header instead of request.ip (which doesn't exist in Next.js)
  const clientId = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`content:${clientId}`);

  // Success headers - cacheable
  const successHeaders = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'Cache-Control': 'public, max-age=3600',
  };

  // Error headers - never cacheable
  const errorHeaders = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: errorHeaders }
    );
  }

  const { url } = await params;
  const searchParams = request.nextUrl.searchParams;
  const useCache = searchParams.get('cache') !== 'false';
  const parse = searchParams.get('parse') === 'true';

  // Validate URL
  const decodedUrl = decodeURIComponent(url);
  const validation = validateUrl(decodedUrl);

  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400, headers: errorHeaders }
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
      }, { headers: successHeaders });
    }
  }

  // Fetch content with redirect validation
  try {
    let currentUrl = finalUrl;
    let redirectCount = 0;
    let response: Response;

    // Manually handle redirects to validate each hop
    while (redirectCount < MAX_REDIRECT_HOPS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual', // Disable automatic redirects
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ImmersiveView/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      clearTimeout(timeoutId);

      // Check if redirect
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Redirect response missing Location header');
        }

        // Validate redirect URL
        const redirectValidation = validateRedirectUrl(currentUrl, location);
        if (!redirectValidation.valid) {
          throw new Error(`Redirect blocked: ${redirectValidation.error}`);
        }

        currentUrl = redirectValidation.url!;
        redirectCount++;
        continue; // Follow redirect
      }

      // Not a redirect, we're done
      break;
    }

    if (redirectCount >= MAX_REDIRECT_HOPS) {
      throw new Error(`Too many redirects (max: ${MAX_REDIRECT_HOPS})`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check content type - only process HTML
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return NextResponse.json(
        { error: 'Only HTML content is supported' },
        { status: 415, headers: errorHeaders }
      );
    }

    // Check content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      return NextResponse.json(
        { error: 'Content too large' },
        { status: 413, headers: errorHeaders }
      );
    }

    // Stream response with size limit
    const html = await readResponseWithLimit(response, MAX_RESPONSE_SIZE);

    // Always return JSON - never serve raw HTML from our origin
    if (!parse) {
      return NextResponse.json({
        success: true,
        html,
        source: response.url,
        contentType,
      }, { headers: successHeaders });
    }

    // Parse content - use currentUrl (post-redirect) for accurate source and relative paths
    const parsed: ExtractedContent = {
      url: currentUrl,
      title: extractTitle(html),
      description: extractDescription(html),
      images: extractImages(html, currentUrl),
      videos: [],
      links: [],
      text: extractText(html),
      contentType,
    };

    // Cache the result
    if (useCache) {
      await cacheContent(currentUrl, parsed);
    }

    return NextResponse.json({
      success: true,
      cached: false,
      content: parsed,
    }, { headers: successHeaders });
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
    }, { status: 500, headers: errorHeaders });
  }
}

// DELETE - Clear cache
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ url: string }> }
) {
  const { url } = await params;
  const headers = {
    'X-RateLimit-Limit': RATE_LIMIT.maxRequests.toString(),
  };

  try {
    const cache = await readCache();

    if (url === 'all') {
      // SECURITY: Require admin auth for bulk cache invalidation
      const session = await auth0.getSession(request);
      if (!session?.user) {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401, headers }
        );
      }

      // Check for admin role
      const roles = session.user['https://binG.com/roles'] || [];
      if (!roles.includes('admin')) {
        return NextResponse.json(
          { error: 'Admin access required for bulk cache invalidation' },
          { status: 403, headers }
        );
      }

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
