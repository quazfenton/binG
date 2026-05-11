import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
  // Browser: Use Web Crypto API
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] / 0x100000000;
  }

  // Node.js: Use dynamic import for crypto module
  if (typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node) {
    const nodeCrypto = require('crypto');
    return nodeCrypto.randomBytes(4).readUInt32LE(0) / 0x100000000;
  }

  throw new Error('No secure random number generator available');
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
 * Sync anonymous session ID with server's ID from response header
 *
 * This ensures client localStorage matches the server's session ID,
 * preventing session fragmentation when they don't match.
 *
 * Call this after fetching from any API that uses resolveFilesystemOwner.
 *
 * @example
 * const response = await fetch('/api/filesystem/list');
 * await syncAnonymousSessionId(response);
 */
export async function syncAnonymousSessionId(response: Response): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const serverSessionId = response.headers.get('x-anonymous-session-id');
    if (serverSessionId) {
      const currentSessionId = localStorage.getItem(ANONYMOUS_SESSION_KEY);
      if (currentSessionId !== serverSessionId) {
        // Server has a different session ID - sync to prevent fragmentation
        console.log('[Session] Syncing localStorage session ID with server:', {
          old: currentSessionId?.substring(0, 20) + '...',
          new: serverSessionId.substring(0, 20) + '...',
        });
        localStorage.setItem(ANONYMOUS_SESSION_KEY, serverSessionId);
      }
    }
  } catch {
    // Ignore errors - localStorage unavailable or header not present
  }
}

/**
 * Build standard request headers for API calls.
 *
 * Includes:
 * - `Authorization: Bearer <token>` when the user is authenticated
 * - `x-anonymous-session-id` for unauthenticated requests (to prevent session fragmentation)
 * - `Content-Type: application/json` when `json` is true (default)
 */
export function buildApiHeaders(options?: { json?: boolean }): Record<string, string> {
  const json = options?.json !== false;
  const headers: Record<string, string> = {};

  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  // Authentication is handled via HttpOnly cookies sent automatically with credentials: 'include'
  // For anonymous users, we send the session ID in a header to prevent session fragmentation
  // during initial page load when multiple components mount before the cookie is set.
  // The server will use this header to set the cookie consistently.
  if (typeof window !== 'undefined') {
    // Guard token lookup with try/catch to handle restricted browser storage contexts
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      
      // Send anonymous session ID to prevent server from generating different IDs
      // for concurrent requests during initial page load
      const anonSessionId = localStorage.getItem(ANONYMOUS_SESSION_KEY);
      if (anonSessionId) {
        headers['x-anonymous-session-id'] = anonSessionId;
      }
    } catch {
      // localStorage unavailable; continue without auth token
    }
  }

  return headers;
}

/**
 * Generate a UUID v4 using crypto.randomUUID or crypto.getRandomValues
 */
export function generateUUID(): string {
  // Browser: Use Web Crypto API
  if (typeof window !== 'undefined') {
    const browserCrypto = (window as any).crypto;
    if (browserCrypto && browserCrypto.randomUUID) {
      return browserCrypto.randomUUID();
    }
    // Manual UUID v4 generation using crypto.getRandomValues
    const array = new Uint8Array(16);
    if (browserCrypto && browserCrypto.getRandomValues) {
      browserCrypto.getRandomValues(array);
    } else {
      // Fallback for older browsers
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    // Set version (4) and variant bits
    array[6] = (array[6] & 0x0f) | 0x40;
    array[8] = (array[8] & 0x3f) | 0x80;
    const hex = Array.from(array, byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  // Node.js: Use dynamic import
  if (typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node) {
    const nodeCrypto = require('crypto');
    if (nodeCrypto.randomUUID) {
      return nodeCrypto.randomUUID();
    }
    return nodeCrypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  }

  throw new Error('No crypto API available');
}
