/**
 * Security Utilities
 *
 * Centralized security functions for path validation, input sanitization,
 * and protection against common attacks.
 */

import { join, resolve, normalize, isAbsolute, sep } from 'path';
import { z } from 'zod';
import { createSecureHash } from './crypto-utils';

/**
 * Path Traversal Protection
 *
 * Safely joins path segments while preventing directory traversal attacks.
 *
 * @param base - The base directory (must be absolute path)
 * @param paths - Path segments to join
 * @returns Resolved absolute path that is guaranteed to be within base
 * @throws Error if resulting path would escape base directory
 *
 * @example
 * ```typescript
 * // Safe usage
 * const workspace = safeJoin('/tmp/workspaces', 'sandbox-123', 'code', 'index.ts');
 * // Returns: '/tmp/workspaces/sandbox-123/code/index.ts'
 *
 * // Attack prevention
 * safeJoin('/tmp/workspaces', '../../etc/passwd');
 * // Throws: Error('Path traversal detected')
 * ```
 */
export function safeJoin(base: string, ...paths: string[]): string {
  // SECURITY: Ensure base is absolute
  if (!base || !isAbsolute(base)) {
    throw new Error(`Base path must be absolute, got: "${base}"`);
  }

  // Normalize base (already absolute)
  const normalizedBase = resolve(base);

  // Join all path segments
  const joined = join(normalizedBase, ...paths);

  // Normalize to resolve any .. or . segments
  const resolved = normalize(joined);

  // SECURITY: Verify the result is still within base
  // Add trailing separator to prevent partial matches
  // e.g., '/tmp/workspaces-evil' would start with '/tmp/workspaces'
  // Normalize separators to forward slashes for cross-platform comparison
  // (handles Windows UNC paths like \\server\share)
  const normalizedBaseForward = normalizedBase.replace(/\\/g, '/');
  const resolvedForward = resolved.replace(/\\/g, '/');

  const baseWithSeparator = normalizedBaseForward.endsWith('/')
    ? normalizedBaseForward
    : normalizedBaseForward + '/';

  if (!resolvedForward.startsWith(baseWithSeparator) && resolvedForward !== normalizedBaseForward) {
    throw new Error(
      `Path traversal detected: "${resolved}" is outside base "${normalizedBase}"`
    );
  }

  return resolved;
}

/**
 * Validates a sandbox/workspace ID format
 * 
 * @param id - The ID to validate
 * @returns true if valid
 * 
 * Security: Prevents injection attacks via ID parameters
 */
export function isValidResourceId(id: string): boolean {
  // Only allow alphanumeric, dash, and underscore
  // Length between 1 and 64 characters
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

/**
 * Validates and sanitizes a file path
 *
 * @param path - The path to validate (must be relative)
 * @param options - Validation options
 * @throws Error if path is invalid
 *
 * Security checks:
 * - No absolute paths
 * - No path traversal (..)
 * - No null bytes
 * - No Windows-style separators
 * - Length limits
 * - URL decoding to prevent encoded traversal attacks
 */
export function validateRelativePath(
  path: string,
  options: {
    maxLength?: number;
    allowExtensions?: string[];
  } = {}
): string {
  const { maxLength = 1000, allowExtensions } = options;

  if (!path || typeof path !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  // SECURITY: URL-decode to catch encoded traversal attempts like ..%2F..%2Fetc
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    // If decoding fails, use original
    decodedPath = path;
  }

  // Check for null bytes (injection attack)
  if (decodedPath.includes('\0')) {
    throw new Error('Path contains null byte');
  }

  // Reject absolute paths
  if (decodedPath.startsWith('/') || decodedPath.startsWith('\\') || /^[a-zA-Z]:/.test(decodedPath)) {
    throw new Error('Path must be relative');
  }

  // Reject path traversal (check both original and decoded)
  if (path.includes('..') || decodedPath.includes('..')) {
    throw new Error('Path contains ".." (potential traversal)');
  }

  // Normalize Windows separators
  const normalized = decodedPath.replace(/\\/g, '/');

  // Check length
  if (normalized.length > maxLength) {
    throw new Error(`Path exceeds maximum length of ${maxLength}`);
  }

  // Check extension if allowed extensions specified
  if (allowExtensions) {
    const ext = normalized.split('.').pop()?.toLowerCase();
    if (!ext || !allowExtensions.includes(ext)) {
      throw new Error(`File extension must be one of: ${allowExtensions.join(', ')}`);
    }
  }

  return normalized;
}

/**
 * Schema for validating sandbox IDs
 */
export const sandboxIdSchema = z
  .string()
  .min(1, 'Sandbox ID cannot be empty')
  .max(64, 'Sandbox ID too long')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Sandbox ID must contain only letters, numbers, dash, and underscore'
  );

/**
 * Schema for validating file paths
 */
export const relativePathSchema = z
  .string()
  .min(1, 'Path cannot be empty')
  .max(1000, 'Path too long')
  .refine(
    (p) => !p.startsWith('/') && !p.startsWith('\\'),
    'Path must be relative'
  )
  .refine(
    (p) => !p.includes('..'),
    'Path cannot contain ".."'
  )
  .refine(
    (p) => !p.includes('\0'),
    'Path contains invalid characters'
  );

/**
 * Schema for validating commands
 */
export const commandSchema = z
  .string()
  .min(1, 'Command cannot be empty')
  .max(10000, 'Command too long')
  .refine(
    (cmd) => {
      // Block dangerous command patterns
      const dangerous = [
        /\brm\s+(-rf|--recursive)\s+\//,  // rm -rf /
        /\bmkfs/,                          // Format disk
        /\bdd\s/,                          // dd command
        /:\(\)\{\s*:\|:\s*&\s*\}\;/,      // Fork bomb
        /\bchmod\s+[0-7]*\s+\/(etc|bin|usr)/,  // chmod system dirs
        /\bchown\s+.*\s+\/(etc|bin|usr)/,     // chown system dirs

        // Download and execute (remote code execution)
        /\bwget\s+.*\|\s*(ba)?sh/,
        /\bcurl\s+.*\|\s*(ba)?sh/,
        /\bwget\s+.*-O\s*-\s*\|/,
        /\bcurl\s+.*-o\s*-\s*\|/,
        
        // Write to system files
        /\becho\s+.*>\s*\/etc/,
        /\bprintf\s+.*>\s*\/etc/,
        /\btee\s+\/etc/,
        /\becho\s+.*>\s*\/dev\/sd/,
        
        // System control
        /\bshutdown\s+(-h|-r)/,
        /\breboot\b/,
        /\bhalt\b/,
        /\bpoweroff\b/,
        /\binit\s+[06]\b/,
        
        // Process killing (init / mass kill)
        /\bkill\s+-9\s+1\b/,
        /\bkillall\s+-9/,
        /\bpkill\s+-9/,
        
        // Disk operations
        />\s*\/dev\/sd/,
        /\bmkfs\.\w+\s+\/dev\/sd/,
        /\bfdisk\s+\/dev\/sd/,
        /\bparted\s+\/dev\/sd/,
        
        // Environment manipulation
        /\bexport\s+LD_PRELOAD/,
        /\bunset\s+PATH\b/,
        
        // Kernel / system module loading
        /\binsmod\b/,
        /\brmmod\b/,
        /\bmodprobe\b/,
      ];
      
      return !dangerous.some(pattern => pattern.test(cmd));
    },
    'Command contains dangerous patterns'
  );

/**
 * Rate Limiter for API endpoints
 * 
 * Simple in-memory rate limiter (for production, use Redis)
 */
export class RateLimiter {
  private requests = new Map<string, { count: number; resetAt: number }>();
  
  constructor(
    readonly maxRequests: number,
    private windowMs: number
  ) {}
  
  /**
   * Check if request is allowed
   * @param identifier - User/IP/endpoint identifier
   * @returns true if allowed, false if rate limited
   */
  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const record = this.requests.get(identifier);

    if (!record || now > record.resetAt) {
      // New window
      this.requests.set(identifier, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return true;
    }

    if (record.count >= this.maxRequests) {
      return false;
    }

    record.count++;
    return true;
  }
  
  /**
   * Get remaining requests in current window
   */
  getRemaining(identifier: string): number {
    const record = this.requests.get(identifier);
    if (!record || Date.now() > record.resetAt) {
      return this.maxRequests;
    }
    return this.maxRequests - record.count;
  }
  
  /**
   * Get retry-after seconds
   */
  getRetryAfter(identifier: string): number {
    const record = this.requests.get(identifier);
    if (!record) return 0;
    return Math.ceil((record.resetAt - Date.now()) / 1000);
  }
  
  /**
   * Clean up old records (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetAt) {
        this.requests.delete(key);
      }
    }
  }
}

/**
 * Security headers for HTTP responses
 */
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Content-Security-Policy': "default-src 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

/**
 * Sanitize string for safe output
 * Prevents XSS by escaping HTML entities
 */
export function sanitizeOutput(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate a secure random ID
 * 
 * @param prefix - Optional prefix for the ID
 * @param length - Length of random part (default: 16)
 */
export function generateSecureId(prefix: string = '', length: number = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return prefix ? `${prefix}_${random}` : random;
}
