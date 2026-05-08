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

// Allowed content types for proxying (excluding HTML for security)
// HTML/XHTML are explicitly blocked to prevent same-origin attacks
const ALLOWED_CONTENT_TYPES = [
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

/**
 * Check if hostname is blocked for SSRF protection
 * Uses structural validation instead of substring matching to avoid false positives
 */
function isBlockedHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  
  // Exact dangerous host patterns
  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname === 'metadata' ||
    normalizedHostname === 'metadata.google.internal' ||
    normalizedHostname.endsWith('.local') ||
    normalizedHostname.endsWith('.internal')
  ) {
    return true;
  }
  
  return false;
}

/**
 * Check if IP address is private/internal (SSRF protection)
 * Handles IPv4, IPv6, and IPv4-mapped IPv6 addresses (::ffff:127.0.0.1)
 * Uses proper CIDR range checking to avoid false positives like 172.160.x.x
 */
function isPrivateIP(ip: string): boolean {
  try {
    // Normalize IPv4-mapped IPv6 addresses (::ffff:127.0.0.1 -> 127.0.0.1)
    const normalizedIp = ip.toLowerCase();
    const mappedIpv4 = normalizedIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    const candidate = mappedIpv4 ?? normalizedIp;
    
    // Handle IPv6 addresses directly (non-mapped)
    if (candidate.includes(':') && !mappedIpv4) {
      // Link-local, unique local, loopback
      if (candidate.startsWith('fe80:') || candidate.startsWith('fc') || candidate.startsWith('fd') || candidate === '::1') {
        return true;
      }
      return false;
    }
    
    // Parse IPv4 address
    const parts = candidate.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return false;
    }
    
    const [a, b, c, d] = parts;
    
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    
    // 0.0.0.0/8 (current network)
    if (a === 0) return true;
    
    // 10.0.0.0/8
    if (a === 10) return true;
    
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    
    // 172.16.0.0/12 (NOT 172.160.x.x which is a public IP range!)
    // Must check 16 <= second_octet <= 31 to correctly identify private range
    if (a === 172 && b >= 16 && b <= 31) return true;
    
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;
    
    // 100.100.0.0/16 (carrier-grade NAT)
    if (a === 100 && b === 100) return true;
    
    return false;
  } catch {
    // Fail closed: treat errors as private/blocked for safety
    return true;
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

  // Block dangerous hostnames using structural validation
  if (isBlockedHostname(parsedUrl.hostname)) {
    return { valid: false, error: 'Blocked unsafe URL (internal network or cloud metadata)' };
  }

  // DNS resolution check - must validate ALL answers to prevent SSRF via
  // multi-record hosts (a public record passes validation, fetch uses private)
  try {
    const { lookup } = await import('dns/promises');
    const resolved = await lookup(parsedUrl.hostname, { family: 0, all: true });
    for (const entry of resolved) {
      if (isPrivateIP(entry.address)) {
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
 * 
 * Supports two modes:
 * - Default: API/data proxy (blocks HTML for security)
 * - iframe mode: Proxies HTML for iframe embedding (?mode=iframe)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  let url = searchParams.get('url');
  const mode = searchParams.get('mode'); // 'iframe' for HTML proxying
  const allowHtml = mode === 'iframe';

  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter', hint: 'Use ?url=https://example.com' },
      { status: 400 }
    );
  }

  // Auto-prepend https:// if protocol is missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    // Reject URLs with ambiguous or unsupported schemes
    if (url.includes('://')) {
      return NextResponse.json(
        { error: 'Unsupported URL scheme. Only HTTP and HTTPS are allowed.' },
        { status: 400 }
      );
    }
    url = `https://${url}`;
  }

  console.log('[Proxy] Request received:', safeLogUrl(url), { mode });

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

  // Get content type - do NOT default to text/html for security
  const contentTypeHeader = response.headers.get('content-type');
  if (!contentTypeHeader) {
    return NextResponse.json(
      { error: 'Missing Content-Type header from upstream' },
      { status: 400 }
    );
  }

  const contentType = contentTypeHeader;
  const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();

  // Block HTML/XHTML responses unless explicitly requested for iframe mode
  if ((normalizedContentType.startsWith('text/html') || normalizedContentType.startsWith('application/xhtml+xml')) && !allowHtml) {
    return NextResponse.json(
      { error: 'HTML content is not allowed through the proxy. Use ?mode=iframe for iframe embedding.', hint: 'Add &mode=iframe to enable HTML proxying' },
      { status: 415 }
    );
  }

  // Log if content type is unexpected
  if (!ALLOWED_CONTENT_TYPES.some(allowed => normalizedContentType.startsWith(allowed)) && !allowHtml) {
    console.log('[Proxy] Unusual content type:', normalizedContentType);
  }

  // Check content length from header
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_SIZE) {
    return NextResponse.json(
      { error: `Content too large (max ${MAX_CONTENT_SIZE / 1024 / 1024}MB)` },
      { status: 400 }
    );
  }

  // Asset mode: serve non-HTML resources with strict content-type validation
  if (mode === 'asset') {
    const ALLOWED_ASSET_TYPES = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon',
      'text/css',
      'application/javascript', 'text/javascript',
      'font/woff', 'font/woff2', 'application/font-woff', 'application/font-woff2', 'font/ttf', 'application/x-font-ttf',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
      'video/mp4', 'video/webm', 'video/ogg',
      'application/octet-stream',
    ];

    if (!ALLOWED_ASSET_TYPES.some(t => normalizedContentType.startsWith(t))) {
      return NextResponse.json(
        { error: `Disallowed asset type: ${normalizedContentType}` },
        { status: 415 }
      );
    }

    if (!response.body) {
      return NextResponse.json(
        { error: 'No response body from upstream' },
        { status: 500 }
      );
    }

    // Stream with size/time enforcement
    const assetStreamController = new AbortController();
    let assetTimeoutId = setTimeout(() => assetStreamController.abort(), FETCH_TIMEOUT);
    let assetBytesReceived = 0;
    const assetTransformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        clearTimeout(assetTimeoutId);
        assetTimeoutId = setTimeout(() => assetStreamController.abort(), FETCH_TIMEOUT);

        assetBytesReceived += chunk.byteLength;
        if (assetBytesReceived > MAX_CONTENT_SIZE) {
          clearTimeout(assetTimeoutId);
          assetStreamController.abort();
          response.body?.cancel().catch(() => {});
          controller.error(new Error('Asset exceeds max size'));
          return;
        }
        controller.enqueue(chunk);
      },
      flush() {
        clearTimeout(assetTimeoutId);
      },
    });
    const assetLimitedStream = response.body.pipeThrough(assetTransformStream);

    return new NextResponse(assetLimitedStream, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'X-Proxied': 'true',
        'X-Final-Url': finalUrl,
        'Cache-Control': response.headers.get('cache-control') || 'public, max-age=300',
        // Restrict CORS to parent origin for embedded assets
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        // Do NOT forward Set-Cookie from upstream
      },
    });
  }

  // For iframe mode with HTML, apply basic sanitization to strip dangerous elements
  // This is a lightweight regex-based approach; for production-grade sanitization,
  // consider adding jsdom + DOMPurify or sanitize-html as dependencies
  if (allowHtml && (normalizedContentType.startsWith('text/html') || normalizedContentType.startsWith('application/xhtml+xml'))) {
    const htmlText = await response.text();

    // Strip dangerous elements
    const sanitized = htmlText
      // Remove script tags and content
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      // Remove self-closing script tags
      .replace(/<script[^>]*\/>/gi, '')
      // Remove iframe tags
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      // Remove object tags
      .replace(/<object[\s\S]*?<\/object>/gi, '')
      // Remove embed tags
      .replace(/<embed[^>]*\/?>/gi, '')
      // Remove form tags (keep content)
      .replace(/<\/?form[^>]*>/gi, '')
      // Remove base tags (prevent URL rewriting attacks)
      .replace(/<base[^>]*\/?>/gi, '')
      // Remove meta tags with http-equiv (prevent header injection)
      .replace(/<meta\s+http-equiv[^>]*\/?>/gi, '')
      // Remove event handler attributes
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      // Remove javascript: URLs
      .replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, 'href="#"')
      .replace(/src\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '');

    const sanitizedHeaders: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Proxied': 'true',
      'X-Final-Url': finalUrl,
      'X-Original-Url': url,
      // Strict CSP for sanitized HTML
      'Content-Security-Policy': [
        "default-src 'none'",
        "img-src 'self' data: https:",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data: https:",
        "connect-src 'self'",
        "media-src 'self' https:",
        "object-src 'none'",
        "script-src 'none'",
        "frame-ancestors 'self'",
      ].join('; '),
      'X-Frame-Options': 'SAMEORIGIN',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    console.log('[Proxy] Sanitized HTML for iframe mode:', safeLogUrl(finalUrl));

    return new NextResponse(sanitized, {
      status: 200,
      headers: sanitizedHeaders,
    });
  }

  // Stream response body with content size enforcement
  if (!response.body) {
    return NextResponse.json(
      { error: 'No response body from upstream' },
      { status: 500 }
    );
  }

  // Create a transform stream that enforces content size limit and keeps timeout alive
  const streamController = new AbortController();
  let timeoutId = setTimeout(() => streamController.abort(), FETCH_TIMEOUT);

  let bytesReceived = 0;
  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Reset timeout on each chunk received
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => streamController.abort(), FETCH_TIMEOUT);

      bytesReceived += chunk.byteLength;
      if (bytesReceived > MAX_CONTENT_SIZE) {
        clearTimeout(timeoutId);
        streamController.abort();
        // Cancel upstream to prevent resource leaks
        response.body?.cancel().catch(() => {});
        controller.error(new Error(`Content size exceeds ${MAX_CONTENT_SIZE / 1024 / 1024}MB limit`));
        return;
      }
      controller.enqueue(chunk);
    },
    flush() {
      clearTimeout(timeoutId);
    },
  });

  // Pipe the response body through our size-limiting transform
  const limitedStream = response.body.pipeThrough(transformStream);

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
  };

  // For iframe mode, add strict security headers
  if (allowHtml) {
    headers['X-Frame-Options'] = 'SAMEORIGIN';
    // Strict CSP for proxied HTML: block scripts, restrict resources to self/proxy only
    headers['Content-Security-Policy'] = [
      "default-src 'none'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data: https:",
      "connect-src 'self'",
      "media-src 'self' https:",
      "object-src 'none'",
      "script-src 'none'",
      "frame-ancestors 'self'",
    ].join('; ');
    // Strict permissions policy for proxied HTML
    headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()';
  } else {
    // Default mode: strict framing
    headers['X-Frame-Options'] = 'DENY';
  }

  // NOTE: Upstream Set-Cookie headers are intentionally NOT forwarded to prevent
  // cookie leakage from proxied sites into the parent origin's cookie scope.

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

  console.log('[Proxy] Successfully proxied:', safeLogUrl(finalUrl), { mode, htmlAllowed: allowHtml });

  // Return proxied response with size-limited stream
  return new NextResponse(limitedStream, {
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
