/**
 * Image Proxy API
 *
 * Proxies external image URLs to bypass CORS and hotlinking restrictions.
 * Usage: /api/image-proxy?url=https://example.com/image.jpg
 *
 * NOTE: Marked force-dynamic because this route does HTTP requests at runtime.
 * The project uses output: 'export' but backend API routes are handled
 * externally in production (see next.config.mjs comment).
 */

export const dynamic = 'force-dynamic';

/**
 * SECURITY: Includes SSRF protection, timeout, and size limits
 * Uses centralized validateImageUrl() for consistent security checks
 *
 * CACHING: Implements multi-layer caching strategy:
 * - Client-side: Strong caching with ETag support (1 year)
 * - Server-side: In-memory LRU cache for frequently accessed images
 */

import { NextRequest, NextResponse } from 'next/server';


import ipaddr from 'ipaddr.js';
import { validateImageUrl, isHostnameSafe } from '@/lib/utils/image-loader';
import { sanitizeUrlInput } from '@/lib/utils/sanitize';
import { createHash } from 'crypto';

// Configuration
const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25MB max image size (increased for high-res generated images)
const FETCH_TIMEOUT = 15000; // 15 second timeout (increased for larger images)

// Transparent 1x1 PNG — returned instead of JSON errors to prevent browser retry storms.
// When a CSS background-image or <img> tag receives JSON instead of valid image data,
// the browser retries indefinitely, flooding the proxy. A valid PNG stops the loop.
// 68 bytes, base64-encoded.
const TRANSPARENT_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TRANSPARENT_PNG = Buffer.from(TRANSPARENT_PNG_B64, 'base64');

/** Return a transparent 1x1 PNG instead of an error — stops browser retry storms */
function transparentErrorResponse(extraHeaders?: Record<string, string>, status = 200): NextResponse {
  const headers: Record<string, string> = {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=60',
    'Access-Control-Allow-Origin': '*',
    'X-Cache': 'ERROR',
    ...extraHeaders,
  };
  return new NextResponse(TRANSPARENT_PNG, { status, headers });
}

// Allowed image content types
// NOTE: SVG is intentionally excluded - it's active content (can execute scripts)
// and poses XSS risks when served from same origin. See security audit notes.
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
];

// In-memory cache for frequently accessed images (LRU-style with TTL)
interface CachedImage {
  data: ArrayBuffer;
  contentType: string;
  etag: string;
  fetchedAt: number;      // When fetched from origin (for TTL calculation)
  lastAccessed: number;   // When last accessed (for LRU eviction ordering)
  size: number;
}

// LRU Cache implementation with automatic eviction
const IMAGE_CACHE = new Map<string, CachedImage>();
const CACHE_MAX_SIZE = 100; // Max number of images to cache
const CACHE_MAX_BYTES = 100 * 1024 * 1024; // 100MB total in-memory cap
const CACHE_TTL = 3600000; // 1 hour TTL in-memory cache

// Track cache metrics for monitoring
let cacheTotalBytes = 0;
let cacheHits = 0;
let cacheMisses = 0;
let cacheEvictions = 0;

// Negative cache for upstream error responses (rate limits, server errors).
// Prevents infinite retry loops: when the upstream returns 429/403/500, we
// cache the error for a short window so repeated requests from the same
// <img> tag don't hammer the origin with fresh requests on every retry.
interface NegativeCacheEntry {
  status: number;
  errorMessage: string;
  cachedAt: number;
}
const NEGATIVE_CACHE = new Map<string, NegativeCacheEntry>();
const NEGATIVE_CACHE_TTL = 60_000; // 1 minute — long enough to break retry storms
const NEGATIVE_CACHE_MAX_SIZE = 500; // guard against unbounded memory growth

// Cleanup expired negative cache entries (runs on the same interval as main cache)
function cleanupNegativeCache(): void {
  const now = Date.now();
  for (const [key, entry] of NEGATIVE_CACHE.entries()) {
    if (now - entry.cachedAt > NEGATIVE_CACHE_TTL) {
      NEGATIVE_CACHE.delete(key);
    }
  }
  // Enforce size cap with LRU eviction
  if (NEGATIVE_CACHE.size > NEGATIVE_CACHE_MAX_SIZE) {
    const entries = Array.from(NEGATIVE_CACHE.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const toDelete = entries.slice(0, entries.length - NEGATIVE_CACHE_MAX_SIZE);
    for (const [key] of toDelete) NEGATIVE_CACHE.delete(key);
  }
}

/** Set a negative cache entry and return error response headers */
function setNegativeCache(cacheKey: string, status: number, errorMessage: string): Record<string, string> {
  NEGATIVE_CACHE.set(cacheKey, { status, errorMessage, cachedAt: Date.now() });
  const headers: Record<string, string> = {
    'Cache-Control': `public, max-age=${Math.ceil(NEGATIVE_CACHE_TTL / 1000)}`,
    'Access-Control-Allow-Origin': '*',
  };
  if (status === 429) {
    headers['Retry-After'] = String(Math.ceil(NEGATIVE_CACHE_TTL / 1000));
  }
  return headers;
}

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_CONTROL_REVALIDATE = 'public, max-age=86400, stale-while-revalidate=3600';

/**
 * Detect whether a URL points to a versioned/immutable resource.
 * Versioned URLs contain a content hash, version number, or build hash in the path
 * and are safe to cache as immutable. All other URLs may change in place and should
 * revalidate to avoid serving stale bytes for up to a year.
 *
 * Matches:
 * - Query params: ?v=123, ?ver=abc123, ?version=xyz
 * - Path versions: /v123/, /v123-file.png
 * - Hash prefixes: -abc123def.png, -abc123def/
 * - Full hashes: /[32-40 hex chars]/, /[32-40 hex chars].ext
 */
function isVersionedUrl(url: string): boolean {
  return /(?:[?&](?:v|ver|version)=[a-z0-9._-]+\b|\/v\d+(?:\/|[.-])|-[a-f0-9]{8,}(?:\.[a-z]+)?(?:[/?#]|$)|\/[a-f0-9]{32,40}(?:\.[a-z0-9]+)?(?:[/?#]|$))/i.test(url);
}

function getCacheControlHeader(url: string): string {
  return isVersionedUrl(url) ? CACHE_CONTROL_IMMUTABLE : CACHE_CONTROL_REVALIDATE;
}

/**
 * Return a log-safe representation of a URL — hostname + cache key fragment.
 * Avoids leaking signed tokens, presigned URLs, or personal identifiers.
 */
function safeLogUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.slice(0, 40)}`;
  } catch {
    return url.slice(0, 60);
  }
}

/**
 * Generate cache key from URL
 */
function getCacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

/**
 * Get cache statistics for monitoring
 */
function getCacheStats(): {
  size: number;
  totalBytes: number;
  maxBytes: number;
  hitRate: number;
  evictions: number;
} {
  const totalRequests = cacheHits + cacheMisses;
  return {
    size: IMAGE_CACHE.size,
    totalBytes: cacheTotalBytes,
    maxBytes: CACHE_MAX_BYTES,
    hitRate: totalRequests > 0 ? cacheHits / totalRequests : 0,
    evictions: cacheEvictions,
  };
}

/**
 * Evict oldest entries until we have enough space
 * Uses LRU (Least Recently Used) eviction strategy
 */
function evictOldestUntilSpaceAvailable(neededBytes: number): void {
  const entries = Array.from(IMAGE_CACHE.entries())
    .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

  let freed = 0;
  for (const [key, value] of entries) {
    if (cacheTotalBytes - freed + neededBytes <= CACHE_MAX_BYTES) break;
    IMAGE_CACHE.delete(key);
    freed += value.size;
    cacheEvictions++;
  }
  cacheTotalBytes -= freed;
}

/**
 * Clean up expired cache entries with LRU eviction
 * Called periodically and when cache exceeds limits
 */
function cleanupCache(): void {
  const now = Date.now();
  let freed = 0;

  // Remove expired entries (based on fetchedAt, not lastAccessed)
  for (const [key, value] of IMAGE_CACHE.entries()) {
    if (now - value.fetchedAt > CACHE_TTL) {
      freed += value.size;
      IMAGE_CACHE.delete(key);
      cacheEvictions++;
    }
  }
  cacheTotalBytes -= freed;

  // Enforce max size using LRU (remove oldest lastAccessed first)
  if (IMAGE_CACHE.size > CACHE_MAX_SIZE) {
    const entries = Array.from(IMAGE_CACHE.entries())
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    const toDelete = entries.slice(0, entries.length - CACHE_MAX_SIZE);
    for (const [key, value] of toDelete) {
      cacheTotalBytes -= value.size;
      IMAGE_CACHE.delete(key);
      cacheEvictions++;
    }
  }
}

/**
 * Get image from cache with LRU tracking
 */
function getCachedImage(cacheKey: string): CachedImage | null {
  const cached = IMAGE_CACHE.get(cacheKey);
  if (!cached) {
    cacheMisses++;
    return null;
  }

  // Check if expired (based on fetchedAt, not lastAccessed)
  if (Date.now() - cached.fetchedAt > CACHE_TTL) {
    cacheTotalBytes -= cached.size;
    IMAGE_CACHE.delete(cacheKey);
    cacheEvictions++;
    cacheMisses++;
    return null;
  }

  // Update lastAccessed for LRU eviction ordering (not for TTL)
  cached.lastAccessed = Date.now();
  IMAGE_CACHE.set(cacheKey, cached);
  cacheHits++;
  return cached;
}

/**
 * Store image in cache with LRU eviction and incremental size tracking
 */
function setCachedImage(cacheKey: string, data: ArrayBuffer, contentType: string, etag: string, imageUrl: string): void {
  const imageSize = data.byteLength;
  const now = Date.now();

  // Periodic cleanup instead of on every write (every 10 writes)
  if (IMAGE_CACHE.size % 10 === 0) {
    cleanupCache();
  }

  // Check if already cached (update case) - adjust byte counter AFTER eviction
  const existing = IMAGE_CACHE.get(cacheKey);
  let existingSize = 0;
  if (existing) {
    existingSize = existing.size;
  }

  // Check byte limit using tracked total (account for update case)
  const effectiveTotal = cacheTotalBytes - existingSize;
  if (effectiveTotal + imageSize > CACHE_MAX_BYTES) {
    // Evict oldest entries until we have space
    evictOldestUntilSpaceAvailable(imageSize - existingSize);

    // Re-calculate total after eviction
    const postEvictionTotal = cacheTotalBytes - existingSize;

    // If still not enough space after eviction, skip caching
    if (postEvictionTotal + imageSize > CACHE_MAX_BYTES) {
      console.log('[Image Proxy] Skipping cache: would exceed memory limit even after eviction', {
        url: safeLogUrl(imageUrl),
        postEvictionTotal,
        imageSize,
        existingSize,
        limit: CACHE_MAX_BYTES,
      });
      return;
    }
  }

  // Update cache - adjust byte counter atomically with map update
  IMAGE_CACHE.set(cacheKey, {
    data,
    contentType,
    etag,
    fetchedAt: now,        // When fetched from origin (for TTL)
    lastAccessed: now,     // When cached (for LRU eviction ordering)
    size: imageSize,
  });

  // Adjust byte counter: subtract old size (if update) and add new size
  cacheTotalBytes = cacheTotalBytes - existingSize + imageSize;
}

// Periodic cache cleanup interval (every 5 minutes)
if (typeof global !== 'undefined' && !(global as any).__imageProxyCacheInterval) {
  (global as any).__imageProxyCacheInterval = setInterval(() => {
    cleanupCache();
    cleanupNegativeCache();
  }, 5 * 60 * 1000);
}

/**
 * Check if IP address is private/internal (SSRF protection)
 */
function isPrivateIP(ip: string): boolean {
  try {
    let addr: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      addr = ipaddr.parse(ip);
    } catch {
      return false; // Invalid IP, will be handled by fetch
    }

    // Check if IP is in private range
    if (addr.kind() === 'ipv4') {
      const ipv4 = addr as ipaddr.IPv4;
      // Block RFC1918 private addresses
      if (ipv4.range() === 'private') return true;
      // Block loopback
      if (ipv4.range() === 'loopback') return true;
      // Block link-local
      if (ipv4.range() === 'linkLocal') return true;
      // Block multicast
      if (ipv4.range() === 'multicast') return true;
    } else {
      const ipv6 = addr as ipaddr.IPv6;
      // Block IPv6 private ranges - use string comparison for type compatibility
      const range: string = ipv6.range();
      if (range === 'private' || range === 'loopback' || range === 'linkLocal') return true;
      // Block IPv4-mapped IPv6 addresses pointing to private IPs
      if (ipv6.isIPv4MappedAddress()) {
        return isPrivateIP(ipv6.toIPv4Address().toString());
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  let imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    );
  }

  // Sanitize URL input to handle edge cases like null bytes and unusual encoding
  try {
    imageUrl = sanitizeUrlInput(imageUrl);
  } catch (sanitizeError: any) {
    console.error('[Image-Proxy] URL sanitization failed:', sanitizeError.message);
    return NextResponse.json(
      { error: sanitizeError.message || 'URL sanitization failed' },
      { status: 400 }
    );
  }

  // Auto-prepend https:// if protocol is missing
  if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    imageUrl = `https://${imageUrl}`;
  }

  // SECURITY: Use centralized URL validation for SSRF protection
  const validation = validateImageUrl(imageUrl);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || 'URL validation failed' },
      { status: 400 }
    );
  }

  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL format' },
      { status: 400 }
    );
  }

  // Generate cache key
  const cacheKey = getCacheKey(imageUrl);

  // Check negative cache first — if we recently got an error from upstream
  // for this URL, return the cached error to break retry storms
  const negativeEntry = NEGATIVE_CACHE.get(cacheKey);
  if (negativeEntry) {
    if (Date.now() - negativeEntry.cachedAt < NEGATIVE_CACHE_TTL) {
      console.log('[Image Proxy] Negative cache hit (rate-limited/error):', safeLogUrl(imageUrl), negativeEntry.status);
      const headers: Record<string, string> = {
        ...setNegativeCache(cacheKey, negativeEntry.status, negativeEntry.errorMessage),
        'X-Cache': 'HIT-NEGATIVE',
      };
      // Return transparent PNG instead of JSON — CSS background-image retries
      // indefinitely on non-image responses, causing request storms.
      return transparentErrorResponse(headers, negativeEntry.status);
    }
    // Expired — remove and fall through to fresh fetch
    NEGATIVE_CACHE.delete(cacheKey);
  }

  // Check in-memory cache first
  const cached = getCachedImage(cacheKey);

  // Check client cache with If-None-Match header (conditional request)
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && cached) {
    // Clean up quotes from ETag
    const cleanEtag = ifNoneMatch.replace(/"/g, '');
    if (cleanEtag === cached.etag) {
      console.log('[Image Proxy] Cache hit (conditional):', safeLogUrl(imageUrl));
      return new NextResponse(null, {
        status: 304, // Not Modified
        headers: {
          'Cache-Control': getCacheControlHeader(imageUrl),
          'ETag': cached.etag,
          'X-Cache': 'HIT',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  // Return cached response if available
  if (cached) {
    console.log('[Image Proxy] Cache hit:', safeLogUrl(imageUrl));
    return new NextResponse(cached.data, {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': getCacheControlHeader(imageUrl),
        'ETag': `"${cached.etag}"`,
        'X-Cache': 'HIT',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  console.log('[Image Proxy] Cache miss, fetching:', safeLogUrl(imageUrl));

  try {
    // Additional SSRF Protection: Resolve and check IP address
    // Note: This is a basic check; production should use DNS resolution with IP validation
    const dns = await import('dns').catch(() => null);
    if (dns && dns.promises) {
      try {
        const addresses = await dns.promises.resolve(url.hostname);
        // Check if ANY resolved IP is private
        if (addresses.some(ip => isPrivateIP(ip))) {
          return NextResponse.json(
            { error: 'Cannot proxy to internal IP addresses' },
            { status: 403 }
          );
        }
      } catch {
        // DNS resolution failed, continue with fetch (will likely fail)
      }
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    // Fetch with manual redirect handling so we can validate each hop
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BinG Image Proxy)',
      },
      signal: controller.signal,
      redirect: 'manual',
    });

    clearTimeout(timeoutId);

    // Handle redirects — validate every Location header before following
    if (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308) {
      const location = response.headers.get('location');
      if (!location) {
        const negHeaders = setNegativeCache(cacheKey, 502, 'Redirect without Location header');
        return transparentErrorResponse(negHeaders);
      }
      // Resolve relative redirects
      const redirectUrl = location.startsWith('http') ? location : new URL(location, imageUrl).toString();
      // Re-validate the redirect target the same way as the original URL
      const redirectValidation = validateImageUrl(redirectUrl);
      if (!redirectValidation.valid) {
        const negHeaders = setNegativeCache(cacheKey, 403, `Redirect target failed SSRF check: ${redirectValidation.error}`);
        return transparentErrorResponse(negHeaders);
      }
      let redirectIp: string | null = null;
      try {
        const dns = await import('dns').catch(() => null);
        if (dns?.promises) {
          const redirectParsed = new URL(redirectUrl);
          const addresses = await dns.promises.resolve(redirectParsed.hostname);
          if (addresses.some(ip => isPrivateIP(ip))) {
            return NextResponse.json({ error: 'Redirect target resolves to internal IP' }, { status: 403 });
          }
          redirectIp = addresses[0];
        }
      } catch {
        // DNS failure on redirect target — reject it
        const dnsNegHeaders = setNegativeCache(cacheKey, 502, 'Redirect target DNS resolution failed');
        return transparentErrorResponse(dnsNegHeaders);
      }
      console.log('[Image Proxy] Following redirect:', safeLogUrl(redirectUrl));
      // Fetch the redirect target with the same manual redirect policy
      const redirectController = new AbortController();
      const redirectTimeoutId = setTimeout(() => redirectController.abort(), FETCH_TIMEOUT);
      const redirectResponse = await fetch(redirectUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BinG Image Proxy)' },
        signal: redirectController.signal,
        redirect: 'manual',
      });
      clearTimeout(redirectTimeoutId);
      // Re-check redirect chain recursively (one level is sufficient for most cases)
      if (redirectResponse.status === 301 || redirectResponse.status === 302 || redirectResponse.status === 303 || redirectResponse.status === 307 || redirectResponse.status === 308) {
        const tooManyHeaders = setNegativeCache(cacheKey, 502, 'Too many redirects');
        return transparentErrorResponse(tooManyHeaders);
      }
      if (!redirectResponse.ok) {
        const redirectErrMsg = `Failed to fetch image: ${redirectResponse.status} ${redirectResponse.statusText}`;
        const redirNegHeaders = setNegativeCache(cacheKey, redirectResponse.status, redirectErrMsg);
        return transparentErrorResponse(redirNegHeaders);
      }
      const contentType = redirectResponse.headers.get('content-type') || 'image/jpeg';
      // Normalize content type by removing charset/parameters and converting to lowercase
      const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.includes(normalizedContentType)) {
        return NextResponse.json({ error: 'Content type not allowed' }, { status: 400 });
      }
      
      // Check Content-Length header before buffering to avoid memory exhaustion
      const contentLength = redirectResponse.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
        console.log('[Image Proxy] Rejecting: Content-Length exceeds limit', {
          contentLength,
          limit: MAX_IMAGE_SIZE,
        });
        return NextResponse.json({ error: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
      }
      
      const arrayBuffer = await redirectResponse.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
        return NextResponse.json({ error: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
      }
      const etag = createHash('sha256').update(new Uint8Array(arrayBuffer)).digest('hex').substring(0, 16);
      setCachedImage(cacheKey, arrayBuffer, contentType, etag, imageUrl);
      return new NextResponse(arrayBuffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': getCacheControlHeader(imageUrl),
          'ETag': `"${etag}"`,
          'X-Cache': 'MISS',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (!response.ok) {
      // Cache the error in negative cache to break immediate retry loops.
      // Without this, every <img> tag retry triggers a fresh upstream fetch,
      // which turns a single 429 into unbounded retries hammering the origin.
      const errorMsg = `Failed to fetch image: ${response.status} ${response.statusText}`;
      const negHeaders = setNegativeCache(cacheKey, response.status, errorMsg);
      return transparentErrorResponse(negHeaders);
    }

    // Get the content type
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Normalize content type by removing charset/parameters and converting to lowercase
    const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();
    
    // Validate content type is an image
    if (!ALLOWED_CONTENT_TYPES.includes(normalizedContentType)) {
      return NextResponse.json(
        { error: 'Content type not allowed' },
        { status: 400 }
      );
    }

    // Check Content-Length header before buffering to avoid memory exhaustion
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
      console.log('[Image Proxy] Rejecting: Content-Length exceeds limit', {
        contentLength,
        limit: MAX_IMAGE_SIZE,
      });
      return NextResponse.json({ error: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
    }

    // Get the image data as array buffer
    const arrayBuffer = await response.arrayBuffer();

    // Validate size
    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` },
        { status: 400 }
      );
    }

    // Generate ETag from content hash
    const etag = createHash('sha256').update(new Uint8Array(arrayBuffer)).digest('hex').substring(0, 16);

    // Store in cache for future requests
    setCachedImage(cacheKey, arrayBuffer, contentType, etag, imageUrl);

    // Return the image with appropriate headers
    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': getCacheControlHeader(imageUrl),
        'ETag': `"${etag}"`,
        'X-Cache': 'MISS',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      const negHeaders = setNegativeCache(cacheKey, 408, 'Request timeout');
      return transparentErrorResponse(negHeaders);
    }
    console.error('[Image Proxy] Error fetching image:', safeLogUrl(imageUrl), error);
    const negHeaders = setNegativeCache(cacheKey, 500, 'Failed to proxy image');
    return transparentErrorResponse(negHeaders);
  }
}
