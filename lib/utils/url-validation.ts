/**
 * Shared URL validation for SSRF protection
 * Used by both client (settings.tsx) and server (image-proxy, image-loader.ts)
 * 
 * SECURITY: Uses anchored regexes to avoid false positives like:
 * - cdn-10.example.com (should NOT be blocked - 10. is not a private IP prefix)
 * - metadata.example.com (should NOT be blocked - not the metadata service)
 * - mylocalhost.com (should NOT be blocked - not localhost)
 */

import { ImageLoader } from 'next/image';

// Blocklisted patterns for SSRF prevention - anchored to avoid false positives
const BLOCKED_PATTERNS = [
  // Localhost variations (anchored to exact match)
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i,
  /^0\.0\.0\.0$/i,
  
  // Private IP ranges (RFC 1918) - anchored to prevent false positives
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/i,
  /^192\.168\.\d{1,3}\.\d{1,3}$/i,
  
  // Link-local and APIPA
  /^169\.254\.\d{1,3}\.\d{1,3}$/i,
  
  // Private/internal hostnames - anchored at both start and end
  /\.local$/i,
  /\.internal$/i,
  /\.private$/i,
  /\.lan$/i,
  
  // Cloud metadata endpoints - exact matches only
  /^169\.254\.169\.254$/i,
  /^metadata\.google\.internal$/i,
  /^100\.100\.100\.200$/i, // Alibaba
  
  // IPv6 localhost and link-local
  /^\[::1\]$/i,
  /^\[fe80:/i,
  /^\[fc00:/i,
  /^\[fd[0-9a-f]{2}:/i,
];

/**
 * Check if hostname is blocked for SSRF protection
 * Uses anchored regexes to prevent false positives
 * 
 * @param hostname - The hostname to check (without port)
 * @returns true if blocked, false if allowed
 */
export function isHostnameBlocked(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      console.warn(`[URLValidation] Blocked SSRF attempt: ${hostname}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Validate background image URL for settings
 * Performs client-side SSRF check before proxying
 * 
 * @param urlString - The URL to validate
 * @returns true if URL is allowed, false if blocked
 */
export function isBackgroundUrlAllowed(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    
    // Must be HTTPS
    if (url.protocol !== 'https:') {
      console.warn('[URLValidation] Blocked non-HTTPS URL:', urlString);
      return false;
    }
    
    // Check hostname against blocklist using anchored patterns
    if (isHostnameBlocked(url.hostname)) {
      console.warn('[URLValidation] Blocked unsafe hostname:', url.hostname);
      return false;
    }
    
    return true;
  } catch {
    console.warn('[URLValidation] Invalid URL:', urlString);
    return false;
  }
}

/**
 * Custom Next.js Image Loader with SSRF Protection
 * Uses shared validation from this module
 */
export function createImageLoader(validateUrl: (url: string) => boolean): ImageLoader {
  return ({ src, width, quality = 75 }) => {
    // For relative paths, use Next.js default optimization
    if (src.startsWith('/') || src.startsWith('./')) {
      return `${src}${src.includes('?') ? '&' : '?'}w=${width}&q=${quality}`;
    }

    // Validate external URLs
    if (!validateUrl(src)) {
      // SECURITY: Return placeholder for blocked URLs
      return `data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2U1ZTdlYiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2U1MzIzMiIgZm9udC1zaXplPSIxNiIgZm9udC13ZWlnaHQ9ImJvbGQiPkJsb2NrZWQ8L3RleHQ+PHRleHQgeD0iNTAlIiB5PSI1NSUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOWNhM2FmIiBmb250LXNpemU9IjEyIj5VbnNhZmUgVVJMPC90ZXh0Pjwvc3ZnPg==`;
    }

    return src;
  };
}

export { BLOCKED_PATTERNS };