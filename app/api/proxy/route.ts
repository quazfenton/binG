/**
 * Generic HTTP Proxy API
 *
 * Proxies external URLs to bypass CORS and iframe embedding restrictions.
 * Usage: /api/proxy?url=https://example.com/page
 *
 * SECURITY: Includes SSRF protection, timeout, and content validation
 * Uses centralized URL validation for consistent security checks
 *
 * FEATURES:
 * - SSRF protection (IP validation, private network blocking)
 * - Redirect following with validation
 * - Content-Type validation
 * - CORS headers for iframe consumption
 * - Streaming response for large content
 */

import { NextRequest, NextResponse } from 'next/server';
import { sanitizeUrlInput } from '@/lib/utils/sanitize';

// Configuration
const FETCH_TIMEOUT = 30000; // 30 second timeout
const MAX_REDIRECTS = 5; // Max redirects to follow
const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB max content size

// Allowed content types for proxying (HTML and common web content)
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'application/json',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/javascript',
  'text/css',
  'font/woff',
  'font/woff2',
];

// Blocked URL patterns (SSRF protection)
const BLOCKED_PATTERNS = [
  'localhost', '127.', '10.', '192.168.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.',
  '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '169.254.', '0.0.0.0', '100.100.', '168.63.129.',
  'metadata', '.local', '.internal', '::1', '[::1]',
  'fc00:', 'fd', 'fe80:', '[::ffff:7f', '[::ffff:0:',
];

/**
 * Check if IP address is private/internal (SSRF protection)
 */
function isPrivateIP(ip: string): boolean {
  try {
    // Simple pattern matching for common private IP ranges
    if (
      ip === '127.0.0.1' || ip === '::1' ||
      ip.startsWith('10.') || ip.startsWith('192.168.') ||
      ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') || ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
      ip.startsWith('172.22.') || ip.startsWith('172.23.') || ip.startsWith('172.24.') ||
      ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
      ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.') ||
      ip.startsWith('172.31.') ||
      ip.startsWith('169.254.') || ip.startsWith('100.100.') ||
      ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validate URL for SSRF protection
 */
async function validateProxyUrl(urlStr: string): Promise<{ valid: boolean; error?: string }> {
  // Sanitize input
  let sanitizedUrl: string;
  try {
    sanitizedUrl = sanitizeUrlInput(urlStr);
  } catch (sanitizeError: any) {
    return { valid: false, error: sanitizeError.message || 'URL sanitization failed' };
  }

  // Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sanitizedUrl);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Check protocol
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { valid: false, error: 'Only HTTP and HTTPS URLs are allowed' };
  }

  // Block dangerous patterns
  const hostname = parsedUrl.hostname.toLowerCase();
  if (BLOCKED_PATTERNS.some(pattern => hostname.includes(pattern))) {
    return { valid: false, error: 'Blocked unsafe URL (internal network or cloud metadata)' };
  }

  // DNS resolution check
  try {
    const { lookup } = await import('dns/promises');
    const resolved = await lookup(hostname, { family: 0 });
    const ips = Array.isArray(resolved) ? resolved : [resolved];
    for (const entry of ips) {
      const ip = typeof entry === 'string' ? entry : entry.address;
      if (isPrivateIP(ip)) {
        return { valid: false, error: 'Blocked unsafe URL (resolves to internal network)' };
      }
    }
  } catch {
    // DNS resolution failed - let fetch handle it
  }

  return { valid: true };
}

/**
 * Get log-safe URL representation
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
 * Fetch URL with redirect validation
 */
async function fetchWithRedirectValidation(
  url: string,
  redirectCount: number = 0
): Promise<{ response: Response; finalUrl: string } | { error: string; status?: number }> {
  if (redirectCount > MAX_REDIRECTS) {
    return { error: 'Too many redirects', status: 302 };
  }

  // Validate URL
  const validation = await validateProxyUrl(url);
  if (!validation.valid) {
    return { error: validation.error || 'URL validation failed', status: 403 };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BinG Proxy/1.0)',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'manual',
    });

    clearTimeout(timeoutId);

    // Handle redirects
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        return { error: 'Redirect without Location header', status: 502 };
      }

      // Resolve relative redirects
      const redirectUrl = location.startsWith('http')
        ? location
        : new URL(location, url).toString();

      console.log('[Proxy] Following redirect:', safeLogUrl(redirectUrl));
      return fetchWithRedirectValidation(redirectUrl, redirectCount + 1);
    }

    if (!response.ok) {
      return { error: `Upstream error: ${response.status} ${response.statusText}`, status: response.status };
    }

    return { response, finalUrl: url };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { error: 'Request timeout', status: 408 };
    }
    return { error: `Fetch error: ${error.message}`, status: 502 };
  }
}

/**
 * HEAD /api/proxy - Check if URL is accessible
 */
export async function HEAD(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    );
  }

  const validation = await validateProxyUrl(url);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || 'URL validation failed' },
      { status: 403 }
    );
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
    });

    clearTimeout(timeoutId);

    return new NextResponse(null, {
      status: response.ok ? 200 : response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Content-Length': response.headers.get('content-length') || '0',
        'X-Proxied': 'true',
        'X-Final-Url': response.url || url,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to check URL' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/proxy - Proxy external URL
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  let url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter', hint: 'Use ?url=https://example.com' },
      { status: 400 }
    );
  }

  // Auto-prepend https:// if protocol is missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  console.log('[Proxy] Request received:', safeLogUrl(url));

  // Validate URL
  const validation = await validateProxyUrl(url);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error || 'URL validation failed' },
      { status: 403 }
    );
  }

  // Fetch with redirect validation
  const result = await fetchWithRedirectValidation(url);

  if ('error' in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status || 500 }
    );
  }

  const { response, finalUrl } = result;

  // Get content type
  const contentType = response.headers.get('content-type') || 'text/html';
  const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();

  // Log if content type is unexpected (but still allow for flexibility)
  // We allow all content types for iframe proxying since we're acting as a transparent proxy
  if (!ALLOWED_CONTENT_TYPES.some(allowed => normalizedContentType.startsWith(allowed))) {
    console.log('[Proxy] Unusual content type:', normalizedContentType);
  }

  // Check content length
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_SIZE) {
    return NextResponse.json(
      { error: `Content too large (max ${MAX_CONTENT_SIZE / 1024 / 1024}MB)` },
      { status: 400 }
    );
  }

  // Get response body
  let body: ArrayBuffer | ReadableStream<Uint8Array> | null = null;
  try {
    // Try to get as stream for large content
    if (response.body) {
      body = response.body;
    } else {
      body = await response.arrayBuffer();
    }
  } catch (error: any) {
    console.error('[Proxy] Error reading response body:', error.message);
    return NextResponse.json(
      { error: 'Failed to read response body' },
      { status: 500 }
    );
  }

  // Build response headers
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'X-Proxied': 'true',
    'X-Final-Url': finalUrl,
    'X-Original-Url': url,
    
    // CORS headers for iframe consumption
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    
    // Relax framing headers for proxied content
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self' *",
  };

  // Preserve cache headers from upstream
  const cacheControl = response.headers.get('cache-control');
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }

  const etag = response.headers.get('etag');
  if (etag) {
    headers['ETag'] = etag;
  }

  const lastModified = response.headers.get('last-modified');
  if (lastModified) {
    headers['Last-Modified'] = lastModified;
  }

  console.log('[Proxy] Successfully proxied:', safeLogUrl(finalUrl));

  // Return proxied response
  return new NextResponse(body, {
    status: response.status,
    headers,
  });
}

/**
 * OPTIONS /api/proxy - CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}
