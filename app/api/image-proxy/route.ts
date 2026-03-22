/**
 * Image Proxy API
 *
 * Proxies external image URLs to bypass CORS and hotlinking restrictions.
 * Usage: /api/image-proxy?url=https://example.com/image.jpg
 *
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
import { createHash } from 'crypto';

// Configuration
const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25MB max image size (increased for high-res generated images)
const FETCH_TIMEOUT = 15000; // 15 second timeout (increased for larger images)

// Allowed image content types
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
];

// In-memory cache for frequently accessed images (LRU-style with TTL)
interface CachedImage {
  data: ArrayBuffer;
  contentType: string;
  etag: string;
  timestamp: number;
  size: number;
}

const IMAGE_CACHE = new Map<string, CachedImage>();
const CACHE_MAX_SIZE = 100; // Max number of images to cache
const CACHE_MAX_BYTES = 100 * 1024 * 1024; // 100MB total in-memory cap
const CACHE_TTL = 3600000; // 1 hour TTL in-memory cache

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_CONTROL_REVALIDATE = 'public, max-age=86400, stale-while-revalidate=3600';

/**
 * Detect whether a URL points to a versioned/immutable resource.
 * Versioned URLs contain a content hash, version number, or build hash in the path
 * and are safe to cache as immutable. All other URLs may change in place and should
 * revalidate to avoid serving stale bytes for up to a year.
 */
function isVersionedUrl(url: string): boolean {
  return /\/(v?\d+|[a-f0-9]{7,}\/|-[a-f0-9]{7,}\.|-[a-f0-9]{8,}[./?#]|[a-f0-9]{32}|[a-f0-9]{40})/.test(url);
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
 * Clean up expired cache entries
 */
function cleanupCache(): void {
  const now = Date.now();
  for (const [key, value] of IMAGE_CACHE.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      IMAGE_CACHE.delete(key);
    }
  }
  // Also enforce max size by removing oldest entries
  if (IMAGE_CACHE.size > CACHE_MAX_SIZE) {
    const entries = Array.from(IMAGE_CACHE.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - CACHE_MAX_SIZE);
    for (const [key] of toDelete) {
      IMAGE_CACHE.delete(key);
    }
  }
}

/**
 * Get image from cache
 */
function getCachedImage(cacheKey: string): CachedImage | null {
  const cached = IMAGE_CACHE.get(cacheKey);
  if (!cached) return null;
  
  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    IMAGE_CACHE.delete(cacheKey);
    return null;
  }
  
  return cached;
}

/**
 * Store image in cache
 */
function setCachedImage(cacheKey: string, data: ArrayBuffer, contentType: string, etag: string, imageUrl: string): void {
  const imageSize = data.byteLength;

  // Cleanup expired entries FIRST so currentSize reflects actual reclaimable space
  cleanupCache();

  // Check if adding this image would exceed byte limit
  const currentSize = Array.from(IMAGE_CACHE.values()).reduce((total, img) => total + img.size, 0);
  if (currentSize + imageSize > CACHE_MAX_BYTES) {
    console.log('[Image Proxy] Skipping cache: would exceed memory limit', {
      url: safeLogUrl(imageUrl),
      currentSize,
      imageSize,
      limit: CACHE_MAX_BYTES,
    });
    return;
  }

  IMAGE_CACHE.set(cacheKey, {
    data,
    contentType,
    etag,
    timestamp: Date.now(),
    size: imageSize,
  });
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
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    );
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

  // Check in-memory cache first
  const cached = getCachedImage(cacheKey);
  if (cached) {
    console.log('[Image Proxy] Cache hit:', safeLogUrl(imageUrl));
    return new NextResponse(cached.data, {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': getCacheControlHeader(imageUrl),
        'ETag': cached.etag,
        'X-Cache': 'HIT',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Check client cache with If-None-Match header
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
        return NextResponse.json({ error: 'Redirect without Location header' }, { status: 502 });
      }
      // Resolve relative redirects
      const redirectUrl = location.startsWith('http') ? location : new URL(location, imageUrl).toString();
      // Re-validate the redirect target the same way as the original URL
      const redirectValidation = validateImageUrl(redirectUrl);
      if (!redirectValidation.valid) {
        return NextResponse.json({ error: `Redirect target failed SSRF check: ${redirectValidation.error}` }, { status: 403 });
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
        return NextResponse.json({ error: 'Redirect target DNS resolution failed' }, { status: 502 });
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
        return NextResponse.json({ error: 'Too many redirects' }, { status: 502 });
      }
      if (!redirectResponse.ok) {
        return NextResponse.json(
          { error: `Failed to fetch image: ${redirectResponse.status} ${redirectResponse.statusText}` },
          { status: redirectResponse.status }
        );
      }
      const contentType = redirectResponse.headers.get('content-type') || 'image/jpeg';
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        return NextResponse.json({ error: 'Content type not allowed' }, { status: 400 });
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
          'Cache-Control': getCacheControlHeader(redirectUrl),
          'ETag': `"${etag}"`,
          'X-Cache': 'MISS',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    // Get the content type
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Validate content type is an image
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: 'Content type not allowed' },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: 'Request timeout' },
        { status: 408 }
      );
    }
    console.error('[Image Proxy] Error fetching image:', safeLogUrl(imageUrl), error);
    return NextResponse.json(
      { error: 'Failed to proxy image' },
      { status: 500 }
    );
  }
}
