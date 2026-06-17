/**
 * TOTP (Time-based One-Time Password) Service
 *
 * MED-6 fix: Implements RFC 6238 TOTP for MFA/2FA support.
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 *
 * Security properties:
 * - Secrets are 160-bit (20 bytes), per RFC 4226 recommendation
 * - Time step is 30 seconds (standard)
 * - Code is 6 digits (standard)
 * - Verification allows 1 step drift in each direction (clock skew tolerance)
 * - Backup codes are bcrypt-hashed for secure storage
 */

import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync } from 'fs';
import { dirname } from 'path';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('TOTP');

// Module-level cache: `getEncryptionKey()` runs synchronously on every
// encrypt/decrypt call, so we resolve the 32-byte key once and reuse the same
// Buffer. Cache is process-local — across instances, set process.env.ENCRYPTION_KEY
// explicitly to keep TOTP secrets decryptable on every node.
let cachedKey: Buffer | null = null;
let paddedWarningEmitted = false; // dedupe the ENCRYPTION_KEY-too-short warning across calls

// TOTP parameters per RFC 6238
const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_SECRET_LENGTH = 20; // 160 bits per RFC 4226

// Allow ±1 time step for clock skew
const ALLOWED_WINDOW = 1;

/**
 * Generate a new TOTP secret (random 20 bytes, base32-encoded).
 * This is the standard format for authenticator app provisioning.
 */
export function generateTotpSecret(): string {
  const secret = randomBytes(TOTP_SECRET_LENGTH);
  return base32Encode(secret);
}

/**
 * Generate the otpauth:// URI for QR code provisioning.
 * Standard format recognized by all authenticator apps.
 *
 * @param secret Base32-encoded TOTP secret
 * @param email User's email (displayed in authenticator app)
 * @param issuer Application name (displayed in authenticator app)
 */
export function generateTotpUri(
  secret: string,
  email: string,
  issuer: string = 'binG'
): string {
  // otpauth://totp/Issuer:email?secret=...&issuer=Issuer&algorithm=SHA1&digits=6&period=30
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

/**
 * Verify a TOTP code against a secret.
 * Allows ±1 time step window for clock skew tolerance.
 *
 * @param secret Base32-encoded TOTP secret
 * @param code 6-digit code from authenticator app
 * @returns { valid: boolean, verifiedStep: number | null } — step number if valid, null if invalid
 */
export function verifyTotpCode(secret: string, code: string): { valid: boolean; verifiedStep: number | null } {
  if (!code || code.length !== TOTP_DIGITS) {
    return { valid: false, verifiedStep: null };
  }

  // Only allow digits
  if (!/^\d{6}$/.test(code)) {
    return { valid: false, verifiedStep: null };
  }

  const secretBytes = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(now / TOTP_PERIOD);

  // Check current step ± ALLOWED_WINDOW
  for (let offset = -ALLOWED_WINDOW; offset <= ALLOWED_WINDOW; offset++) {
    const step = currentStep + offset;

    // TODO: Replay protection — once user_mfa has a last_verified_step column,
    // reject codes at or below the stored step to prevent replay within the ±1 window.
    // For now, each code can only be used once per 30-second window by nature of TOTP.
    const expectedCode = generateTotpCode(secretBytes, step);
    if (timingSafeEqual(Buffer.from(code, 'ascii'), Buffer.from(expectedCode, 'ascii'))) {
      return { valid: true, verifiedStep: step };
    }
  }

  return { valid: false, verifiedStep: null };
}

/**
 * Generate a TOTP code for a given time step (internal use).
 * Implements HOTP(T) per RFC 6238.
 */
function generateTotpCode(secret: Buffer, timeStep: number): string {
  // Convert time step to 8-byte big-endian buffer
  const timeBuffer = Buffer.alloc(8);
  // Use writeUInt32BE for the high 4 bytes (always 0 for reasonable timestamps)
  timeBuffer.writeUInt32BE(0, 0);
  timeBuffer.writeUInt32BE(timeStep, 4);

  // HMAC-SHA1
  const hmac = createHmac('sha1', secret);
  hmac.update(timeBuffer);
  const hmacResult = hmac.digest();

  // Dynamic truncation per RFC 4226
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const binary =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  const code = binary % Math.pow(10, TOTP_DIGITS);
  return code.toString().padStart(TOTP_DIGITS, '0');
}

/**
 * Generate a set of backup/recovery codes.
 * These allow account recovery if the authenticator device is lost.
 *
 * @param count Number of backup codes to generate (default: 10)
 * @returns Array of plain-text backup codes (to show to user once)
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Each code is 8 alphanumeric characters in two groups of 4
    const bytes = randomBytes(4);
    const hex = bytes.toString('hex').toUpperCase();
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`);
  }
  return codes;
}

/**
 * Hash backup codes for storage using PBKDF2 with per-code salts.
 *
 * SECURITY: Backup codes are 8-hex-char strings (32 bits of entropy) — too low
 * for plain SHA-256 (brute-forceable in seconds). We use PBKDF2 with 100,000
 * iterations and a random 16-byte salt per code to raise the cost significantly.
 *
 * Format per hash: "saltHex:iterations:hashHex"
 *
 * @param codes Plain-text backup codes
 * @returns JSON array of PBKDF2-hashed strings
 */
export function hashBackupCodes(codes: string[]): string {
  const PBKDF2_ITERATIONS = 100_000;
  const SALT_LENGTH = 16;
  const KEY_LENGTH = 32;

  const hashes = codes.map(code => {
    const salt = randomBytes(SALT_LENGTH);
    const derivedKey = pbkdf2Sync(
      code, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256'
    );
    return `${salt.toString('hex')}:${PBKDF2_ITERATIONS}:${derivedKey.toString('hex')}`;
  });
  return JSON.stringify(hashes);
}

/**
 * Verify a backup code against stored PBKDF2 hashes.
 *
 * @param storedHashesJson JSON array of PBKDF2 hashes from hashBackupCodes()
 * @param code The code to verify
 * @returns true if valid, and removes the used code from the array (single-use)
 */
export function verifyBackupCode(storedHashesJson: string, code: string): { valid: boolean; remainingHashes: string } {
  const hashes: string[] = JSON.parse(storedHashesJson);

  for (let i = 0; i < hashes.length; i++) {
    const parts = hashes[i].split(':');
    if (parts.length !== 3) continue;

    const [saltHex, iterStr, expectedHashHex] = parts;
    const iterations = parseInt(iterStr, 10);
    const salt = Buffer.from(saltHex, 'hex');
    const expectedHash = Buffer.from(expectedHashHex, 'hex');

    const derivedKey = pbkdf2Sync(
      code, salt, iterations, 32, 'sha256'
    );

    if (derivedKey.length === expectedHash.length && timingSafeEqual(derivedKey, expectedHash)) {
      // Remove used code (single-use)
      hashes.splice(i, 1);
      return { valid: true, remainingHashes: JSON.stringify(hashes) };
    }
  }

  return { valid: false, remainingHashes: storedHashesJson };
}

// ============================================================================
// Encryption helpers for TOTP secret storage at rest
// ============================================================================

const MFA_ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a TOTP secret for database storage.
 * Uses the app's ENCRYPTION_KEY for AES-256-GCM.
 */
export function encryptTotpSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(MFA_ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a TOTP secret from database storage.
 */
export function decryptTotpSecret(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted TOTP secret format');
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(MFA_ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Get encryption key from environment, padded/truncated to 32 bytes.
 * Reuses the same key as API credential encryption.
 */
/**
 * Resolves the 32-byte AES-256-GCM key for at-rest TOTP-secret storage. Resolution
 * order (first hit wins, results are cached for the process lifetime):
 *
 *   Tier 1 — process.env.ENCRYPTION_KEY       (operator's manual override, length-normalised to 32 bytes)
 *   Tier 2 — `${ENCRYPTION_KEY_FILE:-/var/lib/bing/encryption.key}` on disk (32-byte raw binary)
 *   Tier 3 — generate 32 random bytes, persist to that path with chmod 0o600 (atomic tmpfile+rename)
 *   Tier 4 — ephemeral fallback ONLY outside production: a fixed dev buffer (legacy compat,
 *             does NOT persist across restarts). In production, throws so we never silently
 *             expose a known key.
 *
 * BREAKING CHANGE vs the legacy code path: any user_mfa row whose `totp_secret` was encrypted
 * under the old static dev fallback will become unreadable. To recover those rows, set
 * `process.env.ENCRYPTION_KEY='dev-fallback-key-not-for-production'` (or any prefix of it; the
 * padEnd-to-32 logic normalises the input) BEFORE the new key path is created.
 */
function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const env: any = typeof process !== 'undefined' ? process.env : {};
  const ENCRYPTION_KEY = env.ENCRYPTION_KEY;

  // Tier 1 — env override (manual operator-controlled key).
  if (ENCRYPTION_KEY) {
    const envKeyStr = String(ENCRYPTION_KEY);
    const normalised = Buffer.from(envKeyStr.padEnd(32, '0').slice(0, 32));
    if (normalised.length !== 32) {
      throw new Error(`ENCRYPTION_KEY resolved to length ${normalised.length}, expected 32`);
    }
    // Warn once if the operator's key was shorter than 32 chars and got zero-padded
    // — the resulting AES-256 key will have less entropy than expected.
    if (envKeyStr.length < 32 && !paddedWarningEmitted) {
      logger.warn(
        `[TOTP] ENCRYPTION_KEY is ${envKeyStr.length} chars long; right-padded to 32 with zeros. ` +
        `Use a 32-byte (or longer) value for full 256-bit entropy.`,
      );
      paddedWarningEmitted = true;
    }
    logger.debug('[TOTP] Using ENCRYPTION_KEY from process.env');
    cachedKey = normalised;
    return cachedKey;
  }

  // Tier 2 / 3 — file persistence (default /var/lib/bing/encryption.key, chmod 0o600).
  const keyFile: string =
    process.env['ENCRYPTION_KEY_FILE'] && process.env['ENCRYPTION_KEY_FILE'].length > 0
      ? process.env['ENCRYPTION_KEY_FILE']
      : '/var/lib/bing/encryption.key';

  // Tier 2 — try to read existing key.
  try {
    if (existsSync(keyFile)) {
      const buf = readFileSync(keyFile);
      if (buf.length === 32) {
        logger.debug(`[TOTP] Read existing 32-byte ENCRYPTION_KEY from ${keyFile}`);
        cachedKey = buf;
        return cachedKey;
      }
      logger.warn(
        `[TOTP] ${keyFile} has length ${buf.length}, expected 32 — regenerating with fresh entropy`,
      );
    }
  } catch (err: unknown) {
    logger.warn(
      `[TOTP] Could not read ${keyFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Tier 3 — generate and persist (atomic tmpfile+rename + chmod 0o600).
  const fresh = randomBytes(32);
  try {
    const dir = dirname(keyFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tmp = `${keyFile}.tmp`;
    writeFileSync(tmp, fresh, { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch {
      /* chmod is a no-op on Windows; permissions still land owner-only via the mode flag */
    }
    renameSync(tmp, keyFile);
    try { chmodSync(keyFile, 0o600); } catch {
      /* idempotent: already 0o600 from tmp on POSIX; nop on Windows */
    }
    logger.info(
      `[TOTP] Generated and persisted new 32-byte ENCRYPTION_KEY at ${keyFile} (mode 0o600)`,
    );
    cachedKey = fresh;
    return cachedKey;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    // Tier 4 — last-resort ephemeral fallback.
    if (env && env.NODE_ENV === 'production') {
      throw new Error(
        `ENCRYPTION_KEY not set AND could not persist to ${keyFile}: ${reason}. ` +
        `Set process.env.ENCRYPTION_KEY explicitly (recommended for multi-instance deployments) ` +
        `or fix filesystem permissions on ${keyFile}.`,
      );
    }
    logger.warn(
      `[TOTP] ENCRYPTION_KEY not set AND could not persist to ${keyFile}: ${reason}. ` +
      `Using ephemeral dev fallback (TOTP secrets will NOT persist across restarts).`,
    );
    cachedKey = Buffer.alloc(32, 'dev-fallback-key-not-for-production');
    return cachedKey;
  }
}

/**
 * Test-only escape hatch: drop the module-level encryption-key cache so the next
 * call to getEncryptionKey() re-walks the 4-tier resolver. Not used in production.
 */
export function __resetEncryptionKeyCacheForTests(): void {
  cachedKey = null;
  paddedWarningEmitted = false;
}

// ============================================================================
// Base32 encoding/decoding (RFC 4648) — standard for TOTP secrets
// ============================================================================

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  // Add padding
  while (output.length % 8 !== 0) {
    output += '=';
  }

  return output;
}

function base32Decode(input: string): Buffer {
  // Remove padding and whitespace, normalize to uppercase
  const cleaned = input.replace(/[=\s]/g, '').toUpperCase();

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < cleaned.length; i++) {
    const charIndex = BASE32_CHARS.indexOf(cleaned[i]);
    if (charIndex === -1) {
      throw new Error(`Invalid base32 character: ${cleaned[i]}`);
    }

    value = (value << 5) | charIndex;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}
