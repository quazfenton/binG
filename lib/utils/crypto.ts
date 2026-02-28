/**
 * Crypto Utilities
 * 
 * Provides encryption/decryption for sensitive data (secrets, tokens, API keys)
 * Uses AES-256-GCM for authenticated encryption
 * 
 * @security All encryption keys should be stored in environment variables
 * @security Never log encrypted data or encryption keys
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';

/**
 * Derive a 32-byte key from a password/passphrase using scrypt
 * Used for encryption key derivation from environment variables
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

/**
 * Synchronous scrypt key derivation
 */
function scryptSync(password: string, salt: Buffer, keylen: number): Buffer {
  return scrypt(password, salt, keylen, {
    N: 16384, // CPU/memory cost parameter
    r: 8,     // Block size
    p: 1,     // Parallelization parameter
  }) as Buffer;
}

/**
 * Encrypt sensitive data using AES-256-GCM
 * 
 * @param plaintext - The data to encrypt
 * @param key - Encryption key (will be derived from string if provided as string)
 * @returns Encrypted data in format: iv:authTag:encryptedData (hex encoded)
 * 
 * @example
 * ```typescript
 * const encrypted = encryptSecret('my-secret', process.env.ENCRYPTION_KEY);
 * ```
 */
export function encryptSecret(
  plaintext: string,
  key: string | Buffer
): string {
  const encryptionKey = typeof key === 'string' ? deriveKey(key, randomBytes(16)) : key;
  
  // Generate random IV (16 bytes for AES)
  const iv = randomBytes(16);
  
  // Create cipher
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  
  // Encrypt the plaintext
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Get authentication tag (16 bytes for GCM)
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Return format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt sensitive data using AES-256-GCM
 * 
 * @param encrypted - Encrypted data in format: iv:authTag:encryptedData
 * @param key - Decryption key (must match encryption key)
 * @returns Decrypted plaintext
 * 
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 * 
 * @example
 * ```typescript
 * const decrypted = decryptSecret(encryptedData, process.env.ENCRYPTION_KEY);
 * ```
 */
export function decryptSecret(
  encrypted: string,
  key: string | Buffer
): string {
  const encryptionKey = typeof key === 'string' ? deriveKey(key, randomBytes(16)) : key;
  
  // Parse encrypted format: iv:authTag:encryptedData
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format. Expected: iv:authTag:encryptedData');
  }
  
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  // Create decipher
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);
  
  // Decrypt the data
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Check if a string appears to be encrypted data
 * Format: iv:authTag:encryptedData (all hex encoded)
 */
export function isEncryptedFormat(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  
  // Check IV length (16 bytes = 32 hex chars)
  if (parts[0].length !== 32) return false;
  
  // Check auth tag length (16 bytes = 32 hex chars)
  if (parts[1].length !== 32) return false;
  
  // Check encrypted data is non-empty hex
  if (parts[2].length === 0) return false;
  if (!/^[0-9a-fA-F]+$/.test(parts[2])) return false;
  
  return true;
}

/**
 * Generate a secure random secret (e.g., for webhook secrets)
 * 
 * @param length - Length of secret in bytes (default: 32)
 * @returns Hex-encoded random secret
 * 
 * @example
 * ```typescript
 * const secret = generateSecureSecret(32); // 64 character hex string
 * ```
 */
export function generateSecureSecret(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Hash a value using SHA-256
 * Useful for creating non-reversible identifiers
 * 
 * @param value - Value to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function hashValue(value: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Timing-safe comparison of two strings
 * Prevents timing attacks when comparing secrets
 * 
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const { timingSafeEqual: nodeTimingSafeEqual } = require('crypto');
  
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  
  return nodeTimingSafeEqual(aBuffer, bBuffer);
}

/**
 * Get encryption key from environment
 * Falls back to generating a random key if not set (NOT recommended for production)
 * 
 * @param envVarName - Environment variable name (default: ENCRYPTION_KEY)
 * @returns Encryption key
 * 
 * @warning In production, always set ENCRYPTION_KEY environment variable
 * @warning A randomly generated key will not persist across restarts
 */
export function getEncryptionKey(envVarName: string = 'ENCRYPTION_KEY'): Buffer {
  const keyString = process.env[envVarName];
  
  if (!keyString) {
    console.warn(`[${envVarName}] Not set. Using random key (NOT recommended for production)`);
    return randomBytes(32);
  }
  
  // If key is already 32 bytes, use it directly
  if (keyString.length === 64 && /^[0-9a-fA-F]+$/.test(keyString)) {
    return Buffer.from(keyString, 'hex');
  }
  
  // Otherwise derive key from string
  return deriveKey(keyString, randomBytes(16));
}
