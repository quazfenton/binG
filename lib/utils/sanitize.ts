/**
 * Input Sanitization Utilities
 * 
 * Provides sanitization functions for user inputs to prevent injection attacks,
 * null bytes, and unusual encoding that could bypass security filters.
 */

/**
 * Sanitize URL input - handles edge cases like null bytes and unusual encoding
 * @param raw - The raw URL string to sanitize
 * @returns The sanitized URL string
 * @throws Error if URL contains invalid control characters or encoding issues
 */
export function sanitizeUrlInput(raw: string): string {
  // Check for null bytes or control characters that could cause issues
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(raw)) {
    throw new Error('URL contains invalid control characters');
  }

  // Check for unusual encoding patterns that might be attempts to bypass filters
  // Use decodeURI (not decodeURIComponent) to avoid mutating query parameter values
  // decodeURIComponent can decode &= etc. which breaks signed URLs
  try {
    const decoded = decodeURI(raw);
    // Reject if decoding reveals suspicious patterns
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) {
      throw new Error('URL contains invalid characters after decoding');
    }
    // Normalize and re-encode (use encodeURI to preserve query structure)
    return encodeURI(decoded);
  } catch {
    // If decoding fails, check if the raw string is valid ASCII printable
    if (!/^[\x20-\x7E]*$/.test(raw)) {
      throw new Error('URL contains invalid characters');
    }
    return raw;
  }
}

/**
 * Sanitize generic string input - removes null bytes and control characters
 * @param input - The raw string to sanitize
 * @returns The sanitized string with null bytes and control chars removed
 */
export function sanitizeStringInput(input: string): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * Validate and sanitize a URL for SSRF protection
 * @param rawUrl - The raw URL string
 * @returns The sanitized URL ready for SSRF checks
 * @throws Error if URL is invalid or contains suspicious patterns
 */
export function validateAndSanitizeUrl(rawUrl: string): string {
  // First sanitize for edge cases
  const sanitized = sanitizeUrlInput(rawUrl);
  
  // Then validate it's a proper URL
  try {
    new URL(sanitized);
  } catch {
    throw new Error('Invalid URL format');
  }
  
  return sanitized;
}