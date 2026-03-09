/**
 * Cryptographic Utilities
 * 
 * Secure random generation and hashing utilities
 * using Web Crypto API for cross-platform compatibility.
 */

/**
 * Generate a cryptographically secure random hash
 * 
 * @param length - Length of hash in bytes (default: 32)
 * @returns Hex-encoded hash string
 * 
 * @example
 * ```typescript
 * const hash = createSecureHash(32);
 * // Returns: "a1b2c3d4..." (64 hex characters for 32 bytes)
 * ```
 */
export function createSecureHash(length: number = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a secure random string (alphanumeric)
 * 
 * @param length - Length of string (default: 32)
 * @returns Random alphanumeric string
 * 
 * @example
 * ```typescript
 * const random = createSecureRandomString(16);
 * // Returns: "aB3dE7gH9jK2mN5p"
 * ```
 */
export function createSecureRandomString(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  
  return Array.from(bytes)
    .map(b => chars[b % chars.length])
    .join('');
}

/**
 * Generate a UUID v4
 * 
 * @returns UUID string
 * 
 * @example
 * ```typescript
 * const uuid = createUUID();
 * // Returns: "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function createUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  
  // Set version (4) and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 1
  
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'));
  
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/**
 * Hash a string using SHA-256
 * 
 * @param input - Input string to hash
 * @returns Hex-encoded SHA-256 hash
 * 
 * @example
 * ```typescript
 * const hash = await hashString('hello world');
 * // Returns: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
 * ```
 */
export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create HMAC signature
 * 
 * @param data - Data to sign
 * @param secret - Secret key
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export async function createHMAC(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const dataBuffer = encoder.encode(data);
  
  // Import key
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // Sign
  const signature = await crypto.subtle.sign('HMAC', key, dataBuffer);
  const signatureArray = Array.from(new Uint8Array(signature));
  return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify HMAC signature
 * 
 * @param data - Original data
 * @param secret - Secret key
 * @param signature - Signature to verify
 * @returns true if signature is valid
 */
export async function verifyHMAC(
  data: string,
  secret: string,
  signature: string
): Promise<boolean> {
  const expected = await createHMAC(data, secret);
  return expected === signature;
}

/**
 * Constant-time string comparison (prevents timing attacks)
 * 
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Generate secure password
 * 
 * @param length - Password length (default: 32)
 * @param options - Password generation options
 * @returns Secure random password
 */
export function generatePassword(
  length: number = 32,
  options: {
    includeUppercase?: boolean;
    includeLowercase?: boolean;
    includeNumbers?: boolean;
    includeSymbols?: boolean;
  } = {}
): string {
  const {
    includeUppercase = true,
    includeLowercase = true,
    includeNumbers = true,
    includeSymbols = true,
  } = options;
  
  let charset = '';
  if (includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (includeLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (includeNumbers) charset += '0123456789';
  if (includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  if (charset === '') {
    throw new Error('At least one character type must be included');
  }
  
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  
  return Array.from(bytes)
    .map(b => charset[b % charset.length])
    .join('');
}

/**
 * Derive key from password using PBKDF2
 * 
 * @param password - Password string
 * @param salt - Salt (should be random, store with derived key)
 * @param iterations - Number of iterations (default: 100000)
 * @param keyLength - Desired key length in bytes (default: 32)
 * @returns Derived key as hex string
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: string,
  iterations: number = 100000,
  keyLength: number = 32
): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const saltBuffer = encoder.encode(salt);
  
  // Import password as key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  // Derive key
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    keyLength * 8
  );
  
  const derivedArray = Array.from(new Uint8Array(derivedBits));
  return derivedArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
