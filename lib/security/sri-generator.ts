/**
 * Subresource Integrity (SRI) Hash Generator
 *
 * Generates cryptographic hashes for verifying the integrity of
 * externally-hosted resources (CDN scripts, styles, etc.).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
 * @see https://w3c.github.io/webappsec-subresource-integrity/
 *
 * @security SRI prevents:
 * - CDN compromise attacks
 * - Man-in-the-middle tampering
 * - Unauthorized script injection
 */

import { createHash } from 'crypto';

/**
 * Supported hash algorithms for SRI
 *
 * @security SHA-384 is recommended (NIST approved, no known vulnerabilities)
 * SHA-256 is acceptable but provides less security margin
 * SHA-512 provides maximum security but longer hash strings
 */
export type SRIAlgorithm = 'sha256' | 'sha384' | 'sha512';

/**
 * SRI hash result
 */
export interface SRIHash {
  /** Algorithm used */
  algorithm: SRIAlgorithm;
  /** Base64-encoded hash */
  hash: string;
  /** Full integrity attribute value */
  integrity: string;
}

/**
 * Generate SRI hash for content
 *
 * @param content - Resource content (as string or Buffer)
 * @param algorithm - Hash algorithm (default: 'sha384')
 * @returns SRI hash object
 *
 * @example
 * ```typescript
 * // For inline content
 * const sri = generateSRIHash('<script>console.log("hello")</script>');
 * // Returns: { algorithm: 'sha384', hash: '...', integrity: 'sha384-...' }
 *
 * // Use in HTML: <script integrity="${sri.integrity}">
 * ```
 *
 * @security Uses crypto.createHash() for FIPS-compliant hashing
 */
export function generateSRIHash(
  content: string | Buffer,
  algorithm: SRIAlgorithm = 'sha384'
): SRIHash {
  // Convert string to Buffer if needed
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;

  // Create hash
  const hash = createHash(algorithm).update(buffer).digest('base64');

  return {
    algorithm,
    hash,
    integrity: `${algorithm}-${hash}`,
  };
}

/**
 * Generate multiple SRI hashes with different algorithms
 *
 * Provides fallback options for browser compatibility
 *
 * @param content - Resource content
 * @returns Array of SRI hashes (sha256, sha384, sha512)
 *
 * @example
 * ```typescript
 * const hashes = generateSRIHashes(content);
 * // Use: integrity="sha256-... sha384-... sha512-..."
 * ```
 */
export function generateSRIHashes(content: string | Buffer): SRIHash[] {
  return [
    generateSRIHash(content, 'sha256'),
    generateSRIHash(content, 'sha384'),
    generateSRIHash(content, 'sha512'),
  ];
}

/**
 * Verify content against SRI hash
 *
 * @param content - Resource content to verify
 * @param integrity - Expected integrity string (e.g., 'sha384-...')
 * @returns True if content matches hash
 *
 * @example
 * ```typescript
 * const isValid = verifySRIHash(content, 'sha384-abc123...');
 * if (!isValid) {
 *   throw new Error('Resource integrity check failed');
 * }
 * ```
 *
 * @security Critical for validating CDN resources before execution
 */
export function verifySRIHash(
  content: string | Buffer,
  integrity: string
): boolean {
  // Parse integrity string
  const parts = integrity.split('-');
  if (parts.length !== 2) {
    return false;
  }

  const [algorithm, expectedHash] = parts;

  // Validate algorithm
  if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) {
    return false;
  }

  // Generate hash and compare
  const actualHash = createHash(algorithm as SRIAlgorithm)
    .update(typeof content === 'string' ? Buffer.from(content, 'utf8') : content)
    .digest('base64');

  // Constant-time comparison to prevent timing attacks
  return constantTimeCompare(actualHash, expectedHash);
}

/**
 * Constant-time string comparison
 *
 * Prevents timing attacks by ensuring comparison takes same time
 * regardless of where strings differ
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 *
 * @security Prevents timing-based hash comparison attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  // Length check (not constant-time, but necessary)
  if (a.length !== b.length) {
    return false;
  }

  // Convert to buffers for byte-by-byte comparison
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');

  // Use crypto.timingSafeEqual if available (Node.js 6+)
  if (typeof require !== 'undefined') {
    try {
      const { timingSafeEqual } = require('crypto');
      return timingSafeEqual(aBuffer, bBuffer);
    } catch {
      // Fallback to manual comparison
    }
  }

  // Manual constant-time comparison
  let result = 0;
  for (let i = 0; i < aBuffer.length; i++) {
    result |= aBuffer[i] ^ bBuffer[i];
  }
  return result === 0;
}

/**
 * Fetch resource and generate SRI hash
 *
 * @param url - Resource URL
 * @param options - Fetch options
 * @returns SRI hash object
 *
 * @example
 * ```typescript
 * const sri = await fetchAndHashResource('https://cdn.example.com/script.js');
 * // Use: <script src="..." integrity="${sri.integrity}">
 * ```
 *
 * @security Validates HTTPS URLs only (no HTTP allowed)
 */
export async function fetchAndHashResource(
  url: string,
  options?: {
    algorithm?: SRIAlgorithm;
    timeout?: number;
  }
): Promise<SRIHash> {
  // SECURITY: Only allow HTTPS URLs
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('SRI only supports HTTPS resources');
  }

  const timeout = options?.timeout || 30000; // 30 second default timeout

  // Fetch resource
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      ...options,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch resource: ${response.status} ${response.statusText}`);
    }

    const content = await response.arrayBuffer();
    return generateSRIHash(Buffer.from(content), options?.algorithm);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate SRI hashes for multiple resources
 *
 * @param resources - Array of resource URLs or content objects
 * @returns Map of URLs to SRI hashes
 *
 * @example
 * ```typescript
 * const resources = [
 *   'https://cdn.example.com/script1.js',
 *   'https://cdn.example.com/script2.js',
 * ];
 * const hashes = await hashMultipleResources(resources);
 * ```
 */
export async function hashMultipleResources(
  resources: Array<string | { url: string; content?: string }>
): Promise<Map<string, SRIHash>> {
  const results = new Map<string, SRIHash>();

  await Promise.all(
    resources.map(async (resource) => {
      try {
        let hash: SRIHash;

        if (typeof resource === 'string') {
          hash = await fetchAndHashResource(resource);
          results.set(resource, hash);
        } else if (resource.content) {
          hash = generateSRIHash(resource.content);
          results.set(resource.url, hash);
        } else {
          hash = await fetchAndHashResource(resource.url);
          results.set(resource.url, hash);
        }
      } catch (error) {
        console.error(`Failed to hash resource ${typeof resource === 'string' ? resource : resource.url}:`, error);
        results.set(typeof resource === 'string' ? resource : resource.url, {
          algorithm: 'sha384',
          hash: '',
          integrity: '',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  return results;
}

/**
 * Common CDN resources with pre-computed SRI hashes
 *
 * These hashes should be verified periodically and updated as needed
 */
export const KNOWN_CDN_RESOURCES: Record<string, SRIHash> = {
  // React (example - verify before use)
  'https://unpkg.com/react@18/umd/react.production.min.js': {
    algorithm: 'sha384',
    hash: 'TODO_VERIFY',
    integrity: 'sha384-TODO_VERIFY',
  },
  // React DOM (example - verify before use)
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js': {
    algorithm: 'sha384',
    hash: 'TODO_VERIFY',
    integrity: 'sha384-TODO_VERIFY',
  },
};

/**
 * Validate known CDN resource hashes
 *
 * Fetches resources and verifies their hashes match expected values
 *
 * @returns Validation results
 *
 * @security Run periodically to detect CDN compromises
 */
export async function validateKnownResources(): Promise<
  Array<{
    url: string;
    valid: boolean;
    expected?: SRIHash;
    actual?: SRIHash;
    error?: string;
  }>
> {
  const results = [];

  for (const [url, expectedHash] of Object.entries(KNOWN_CDN_RESOURCES)) {
    try {
      const actualHash = await fetchAndHashResource(url);
      const isValid = actualHash.hash === expectedHash.hash;

      results.push({
        url,
        valid: isValid,
        expected: expectedHash,
        actual: actualHash,
      });

      if (!isValid) {
        console.warn(`SRI hash mismatch for ${url}`);
        console.warn('Expected:', expectedHash.integrity);
        console.warn('Actual:', actualHash.integrity);
      }
    } catch (error) {
      results.push({
        url,
        valid: false,
        expected: expectedHash,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

/**
 * Generate HTML script tag with SRI
 *
 * @param src - Script URL
 * @param integrity - SRI integrity string
 * @param options - Additional attributes
 * @returns HTML string
 *
 * @example
 * ```typescript
 * const script = generateScriptTag(
 *   'https://cdn.example.com/app.js',
 *   'sha384-abc123...',
 *   { async: true, crossorigin: 'anonymous' }
 * );
 * ```
 */
export function generateScriptTag(
  src: string,
  integrity: string,
  options?: {
    async?: boolean;
    defer?: boolean;
    crossorigin?: 'anonymous' | 'use-credentials';
    nonce?: string;
  }
): string {
  const attrs: string[] = [
    `src="${src}"`,
    `integrity="${integrity}"`,
    `crossorigin="${options?.crossorigin || 'anonymous'}"`,
  ];

  if (options?.async) {
    attrs.push('async');
  }

  if (options?.defer) {
    attrs.push('defer');
  }

  if (options?.nonce) {
    attrs.push(`nonce="${options.nonce}"`);
  }

  return `<script ${attrs.join(' ')}></script>`;
}

/**
 * Generate HTML link tag with SRI
 *
 * @param href - Stylesheet URL
 * @param integrity - SRI integrity string
 * @param options - Additional attributes
 * @returns HTML string
 */
export function generateLinkTag(
  href: string,
  integrity: string,
  options?: {
    rel?: string;
    crossorigin?: 'anonymous' | 'use-credentials';
    nonce?: string;
  }
): string {
  const attrs: string[] = [
    `href="${href}"`,
    `integrity="${integrity}"`,
    `crossorigin="${options?.crossorigin || 'anonymous'}"`,
  ];

  if (options?.rel) {
    attrs.push(`rel="${options.rel}"`);
  } else {
    attrs.push('rel="stylesheet"');
  }

  if (options?.nonce) {
    attrs.push(`nonce="${options.nonce}"`);
  }

  return `<link ${attrs.join(' ')} />`;
}
