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
const CACHE_TTL = 3600000; // 1 hour TTL for in-memory cache

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
function setCachedImage(cacheKey: string, data: ArrayBuffer, contentType: string, etag: string): void {
  // Cleanup before adding new entry
  cleanupCache();
  
  IMAGE_CACHE.set(cacheKey, {
    data,
    contentType,
    etag,
    timestamp: Date.now(),
    size: data.byteLength,
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
    console.log('[Image Proxy] Cache hit:', imageUrl);
    return new NextResponse(cached.data, {
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
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
      console.log('[Image Proxy] Cache hit (conditional):', imageUrl);
      return new NextResponse(null, {
        status: 304, // Not Modified
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'ETag': cached.etag,
          'X-Cache': 'HIT',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  console.log('[Image Proxy] Cache miss, fetching:', imageUrl);

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

    // Fetch the image from the external URL
    const response = await fetch(imageUrl, {
      headers: {
        // Some servers require a user-agent
        'User-Agent': 'Mozilla/5.0 (compatible; BinG Image Proxy)',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
    setCachedImage(cacheKey, arrayBuffer, contentType, etag);

    // Return the image with appropriate headers
    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': `"${etag}"`,
        'X-Cache': 'MISS',
        // Allow CORS for CSS background usage
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
    console.error('[Image Proxy] Error fetching image:', error);
    return NextResponse.json(
      { error: 'Failed to proxy image' },
      { status: 500 }
    );
  }
}
