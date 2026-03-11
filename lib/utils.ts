import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import crypto from 'crypto';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Cryptographically secure random utilities
 * Use these instead of Math.random() for security-sensitive operations
 */

/**
 * Generate a cryptographically secure random number between 0 and 1
 * Uses crypto.getRandomValues in browser, crypto.randomBytes in Node.js
 */
export function secureRandom(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] / 0x100000000;
  }

  // Fallback for Node.js environment
  try {
    return crypto.randomBytes(4).readUInt32LE(0) / 0x100000000;
  } catch {
    throw new Error('No secure random number generator available');
  }
}

/**
 * Generate a cryptographically secure random integer between min and max (inclusive)
 */
export function secureRandomInt(min: number, max: number): number {
  const range = max - min + 1;
  const randomValue = secureRandom();
  return Math.floor(randomValue * range) + min;
}

/**
 * Generate a cryptographically secure random string
 * @param length - Length of the string
 * @param charset - Characters to use (default: alphanumeric)
 */
export function secureRandomString(length: number, charset?: string): string {
  const chars = charset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(secureRandom() * chars.length);
    result += chars[randomIndex];
  }
  
  return result;
}

/**
 * Generate a unique ID with timestamp and secure random component
 * Format: prefix_timestamp_random
 */
export function generateSecureId(prefix: string = 'id'): string {
  const timestamp = Date.now();
  const randomPart = secureRandomString(9);
  return `${prefix}_${timestamp}_${randomPart}`;
}

// ---------------------------------------------------------------------------
// Client-side session & auth header helpers
// ---------------------------------------------------------------------------

const ANONYMOUS_SESSION_KEY = 'anonymous_session_id';
const AUTH_TOKEN_KEY = 'token';

/**
 * Get-or-create the anonymous session ID persisted in localStorage.
 *
 * This is the **single source of truth** for anonymous identity on the client.
 * Every hook / component that needs an anonymous session ID MUST call this
 * function instead of reimplementing the localStorage logic.
 */
export function getOrCreateAnonymousSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';

  try {
    let sessionId = localStorage.getItem(ANONYMOUS_SESSION_KEY);
    if (!sessionId) {
      sessionId = generateSecureId('anon');
      localStorage.setItem(ANONYMOUS_SESSION_KEY, sessionId);
    }
    return sessionId;
  } catch {
    // localStorage unavailable (Safari private, etc.)
    return generateSecureId('anon');
  }
}

/**
 * Build standard request headers for API calls.
 *
 * Includes:
 * - `Authorization: Bearer <token>` when the user is authenticated
 * - `x-anonymous-session-id` for unauthenticated requests
 * - `Content-Type: application/json` when `json` is true (default)
 */
export function buildApiHeaders(options?: { json?: boolean }): Record<string, string> {
  const json = options?.json !== false;
  const headers: Record<string, string> = {};

  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    headers['x-anonymous-session-id'] = getOrCreateAnonymousSessionId();
  }

  return headers;
}

/**
 * Generate a UUID v4 using crypto.randomUUID or crypto.getRandomValues
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  
  // Manual UUID v4 generation using crypto.getRandomValues
  const array = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Node.js fallback
    try {
      const bytes = crypto.randomBytes(16);
      array.set(bytes);
    } catch {
      throw new Error('No secure random number generator available');
    }
  }
  
  // Set version (4) and variant bits
  array[6] = (array[6] & 0x0f) | 0x40;
  array[8] = (array[8] & 0x3f) | 0x80;
  
  const hex = Array.from(array, byte => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
