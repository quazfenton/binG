/**
 * Server-side secure ID generation
 * 
 * This module is server-only and uses Node.js crypto for secure random generation.
 * DO NOT import this file in Client Components.
 */

import crypto from 'crypto';

/**
 * Generate a unique ID with timestamp and secure random component
 * Format: prefix_timestamp_random
 */
export function generateSecureId(prefix: string = 'id'): string {
  const timestamp = Date.now();
  const randomPart = crypto.randomBytes(9).toString('hex');
  return `${prefix}_${timestamp}_${randomPart}`;
}

/**
 * Generate a cryptographically secure random string
 * @param length - Length of the string
 * @param charset - Characters to use (default: alphanumeric)
 */
export function secureRandomString(length: number, charset?: string): string {
  const chars = charset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomBytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }

  return result;
}
