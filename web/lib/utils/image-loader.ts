/**
 * Custom Next.js Image Loader with SSRF Protection
 * 
 * This loader validates image URLs to block SSRF-prone domains while
 * allowing custom images from legitimate sources.
 * 
 * SECURITY: Blocks the following at runtime:
 * - localhost/internal IPs (127.x.x.x, 10.x.x.x, 192.168.x.x, 172.16-31.x.x)
 * - Cloud metadata endpoints (169.254.169.254)
 * - Private hostnames (.local, .internal, etc.)
 * - URL-encoded bypass attempts
 * - Credential injection attempts
 */

import { ImageLoader } from 'next/image';

// Blocklisted patterns for SSRF prevention
const BLOCKED_PATTERNS = [
  // Localhost variations
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i,
  /^0\.0\.0\.0$/i,
  
  // Private IP ranges (RFC 1918)
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/i,
  /^192\.168\.\d{1,3}\.\d{1,3}$/i,
  
  // Link-local and APIPA
  /^169\.254\.\d{1,3}\.\d{1,3}$/i,
  
  // Private/internal hostnames
  /\.local$/i,
  /\.internal$/i,
  /\.private$/i,
  /\.lan$/i,
  
  // Cloud metadata endpoints
  /^169\.254\.169\.254$/i,
  /^metadata\.google\.internal$/i,
  /^100\.100\.100\.200$/i, // Alibaba
  
  // IPv6 localhost
  /^\[::1\]$/i,
  /^\[fe80:/i, // Link-local IPv6
  /^\[fc00:/i, // Unique local IPv6
  /^\[fd[0-9a-f]{2}:/i, // Unique local IPv6
];

// Allowed patterns (trusted CDNs and image hosts)
const ALLOWED_PATTERNS = [
  /^images\.unsplash\.com$/i,
  /^.*\.unsplash\.com$/i,
  /^.*\.pinimg\.com$/i,
  /^.*\.tenor\.com$/i,
  /^.*\.behance\.net$/i,
  /^.*\.dribbble\.com$/i,
  /^.*\.giphy\.com$/i,
  /^cdn\.dribbble\.com$/i,
  /^media\.giphy\.com$/i,
  /^media\.tenor\.com$/i,
  /^mir-s3-cdn-cf\.behance\.net$/i,
  /^i\.pinimg\.com$/i,
];

/**
 * Decode URL to catch encoded bypass attempts
 */
function decodeUrl(url: string): string {
  try {
    // Decode URL-encoded characters
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * Check if URL contains dangerous patterns
 */
function hasDangerousPatterns(url: string): boolean {
  const decoded = decodeUrl(url);
  
  // Check for credential injection (user:pass@host)
  if (/https?:\/\/[^/]*@/.test(decoded)) {
    return true;
  }
  
  // Check for backslash tricks (some browsers treat \ as /)
  if (decoded.includes('\\')) {
    return true;
  }
  
  // Check for double-encoding
  if (/%25[0-9a-f]{2}/i.test(decoded)) {
    return true;
  }
  
  // Check for protocol tricks
  if (/https?:\/\/https?:/i.test(decoded)) {
    return true;
  }
  
  return false;
}

/**
 * Check if a hostname is safe to load images from
 */
function isHostnameSafe(hostname: string): boolean {
  // Check blocklist first
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(hostname)) {
      console.warn(`[ImageLoader] Blocked SSRF attempt: ${hostname}`);
      return false;
    }
  }
  
  // Allow if matches trusted patterns
  for (const pattern of ALLOWED_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }
  
  // For custom domains, allow if:
  // 1. Uses HTTPS (already enforced by Next.js remotePatterns)
  // 2. Has a valid TLD (not a bare IP or internal hostname)
  // 3. Doesn't look like an internal service
  
  // Reject bare IP addresses (except already-allowed ones)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    console.warn(`[ImageLoader] Blocked IP address: ${hostname}`);
    return false;
  }
  
  // Reject hostnames without a proper TLD
  const parts = hostname.split('.');
  if (parts.length < 2 || parts[parts.length - 1].length < 2) {
    console.warn(`[ImageLoader] Blocked invalid hostname: ${hostname}`);
    return false;
  }
  
  // Allow the hostname
  return true;
}

/**
 * Parse URL and extract hostname
 */
function getHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Validate image URL for SSRF safety
 * Auto-prepends https:// if protocol is missing
 */
export function validateImageUrl(url: string): { valid: boolean; error?: string } {
  // Auto-prepend https:// if protocol is missing
  let normalizedUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    normalizedUrl = `https://${url}`;
  }
  
  // Must be HTTPS
  if (!normalizedUrl.startsWith('https://')) {
    return { valid: false, error: 'Only HTTPS URLs are allowed' };
  }

  // Check for dangerous URL patterns
  if (hasDangerousPatterns(normalizedUrl)) {
    return { valid: false, error: 'URL contains dangerous patterns' };
  }

  const hostname = getHostname(normalizedUrl);
  if (!hostname) {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (!isHostnameSafe(hostname)) {
    return { valid: false, error: `Hostname not allowed: ${hostname}` };
  }

  return { valid: true, error: undefined };
}

/**
 * Custom Next.js Image Loader
 *
 * SECURITY: Returns placeholder for blocked URLs - NEVER returns unsafe URLs
 *
 * @param src - Image source URL
 * @param width - Desired image width
 * @param quality - Image quality (1-100)
 * @returns Optimized image URL or placeholder if validation fails
 */
const imageLoader: ImageLoader = ({ src, width, quality = 75 }) => {
  // For relative paths, use Next.js default optimization
  if (src.startsWith('/') || src.startsWith('./')) {
    // FIX: Handle URLs that already have query strings
    return `${src}${src.includes('?') ? '&' : '?'}w=${width}&q=${quality}`;
  }

  // Validate external URLs
  const validation = validateImageUrl(src);
  if (!validation.valid) {
    console.error(`[ImageLoader] Blocked unsafe image URL: ${src} - ${validation.error}`);
    // SECURITY: Return placeholder instead of unsafe URL
    // This enforces the SSRF/domain block check
    return `data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2U1ZTdlYiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2U1MzIzMiIgZm9udC1zaXplPSIxNiIgZm9udC13ZWlnaHQ9ImJvbGQiPkJsb2NrZWQ8L3RleHQ+PHRleHQgeD0iNTAlIiB5PSI1NSUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOWNhM2FmIiBmb250LXNpemU9IjEyIj5VbnNhZmUgVVJMPC90ZXh0Pjwvc3ZnPg==`;
  }

  // For Next.js image optimization, return the source as-is
  // Next.js will handle the optimization based on remotePatterns
  return src;
};

export default imageLoader;

// Export validation function for use in API routes
export { isHostnameSafe, getHostname };
