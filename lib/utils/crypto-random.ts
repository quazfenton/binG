/**
 * Crypto-Secure Random Utilities
 * 
 * Provides cryptographically secure random number generation
 * as a secure alternative to Math.random()
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomValues
 * @see https://nodejs.org/api/crypto.html
 */

/**
 * Generate a cryptographically secure random number between 0 and 1
 * Client-side: Uses crypto.getRandomValues()
 * Server-side: Uses crypto.randomFillSync()
 */
export function secureRandom(): number {
  if (typeof window !== 'undefined' && window.crypto) {
    // Client-side
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] / (0xFFFFFFFF + 1);
  } else {
    // Server-side (Node.js)
    const crypto = require('crypto');
    const buffer = Buffer.alloc(4);
    crypto.randomFillSync(buffer);
    return buffer.readUInt32BE(0) / (0xFFFFFFFF + 1);
  }
}

/**
 * Generate a cryptographically secure random integer in range [min, max]
 */
export function secureRandomInt(min: number, max: number): number {
  if (typeof window !== 'undefined' && window.crypto) {
    // Client-side
    const range = max - min + 1;
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return min + (array[0] % range);
  } else {
    // Server-side (Node.js)
    const crypto = require('crypto');
    const buffer = Buffer.alloc(4);
    crypto.randomFillSync(buffer);
    const range = max - min + 1;
    return min + (buffer.readUInt32BE(0) % range);
  }
}

/**
 * Generate a cryptographically secure random string
 * @param length - Length of the string to generate
 * @param charset - Character set to use (default: alphanumeric)
 */
export function secureRandomString(
  length: number = 16,
  charset: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
): string {
  let result = '';
  
  if (typeof window !== 'undefined' && window.crypto) {
    // Client-side
    const array = new Uint32Array(length);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      result += charset[array[i] % charset.length];
    }
  } else {
    // Server-side (Node.js)
    const crypto = require('crypto');
    const buffer = Buffer.alloc(length);
    crypto.randomFillSync(buffer);
    for (let i = 0; i < length; i++) {
      result += charset[buffer[i] % charset.length];
    }
  }
  
  return result;
}

/**
 * Generate a cryptographically secure random ID
 * Similar to Math.random().toString(36).slice(2) but secure
 */
export function secureRandomId(prefix: string = ''): string {
  const id = secureRandomString(12, 'abcdefghijklmnopqrstuvwxyz0123456789');
  return prefix ? `${prefix}${id}` : id;
}

/**
 * Generate a cryptographically secure random UUID v4
 */
export function secureRandomUUID(): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    // Modern browsers
    return window.crypto.randomUUID();
  } else {
    // Server-side or older browsers
    const crypto = require('crypto');
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }
    
    // Fallback: generate UUID manually
    const bytes = new Uint8Array(16);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(bytes);
    } else {
      crypto.randomFillSync(Buffer.from(bytes));
    }
    
    // Set version (4) and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    
    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

/**
 * Generate a cryptographically secure random seed for image generation
 * Range: 0 to 2147483647 (max int32)
 */
export function secureRandomSeed(): number {
  return secureRandomInt(0, 2147483647);
}

/**
 * Add jitter to a delay value using secure random
 * @param delay - Base delay in ms
 * @param factor - Jitter factor (0-1), default 0.1 (10%)
 */
export function secureJitter(delay: number, factor: number = 0.1): number {
  const jitterRange = delay * factor;
  const jitter = (secureRandom() - 0.5) * 2 * jitterRange;
  return delay + jitter;
}

/**
 * Secure shuffle array using Fisher-Yates with crypto random
 */
export function secureShuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Pick a random item from an array securely
 */
export function securePick<T>(array: T[]): T | undefined {
  if (array.length === 0) return undefined;
  const index = secureRandomInt(0, array.length - 1);
  return array[index];
}
