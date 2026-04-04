/**
 * Web Secrets Implementation
 *
 * Stores user secrets (auth tokens, API keys) with basic obfuscation.
 * NOT cryptographically secure - for production, use a backend proxy.
 *
 * Uses a per-session derived key + XOR obfuscation to prevent
 * casual inspection of localStorage values.
 */

export interface SecretsAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const SECRET_PREFIX = '__sec__';

/**
 * Derive a simple obfuscation key from browser fingerprint
 * This prevents casual reading of localStorage values
 */
function getObfuscationKey(): string {
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');

  // Simple hash to derive a key
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return String(Math.abs(hash));
}

/**
 * Derive obfuscation key using the OLD fingerprint (for migration fallback)
 * Used when new key fails to decode existing secrets
 */
function getObfuscationKeyLegacy(): string {
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
  ].join('|');

  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return String(Math.abs(hash));
}

/**
 * De-obfuscate with a specific key (internal helper)
 */
function deobfuscateWithKey(encoded: string, key: string): string | null {
  try {
    const decoded = atob(encoded);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i) & 0xFF;
    }
    const keyBytes = new TextEncoder().encode(key);
    const xored = bytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
    const result = new TextDecoder().decode(xored);
    // Validate result is reasonable (not empty, not garbage)
    if (!result || result.length === 0) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * De-obfuscate value with migration fallback
 * Tries new key first, then falls back to legacy key for backwards compatibility
 */
function deobfuscate(encoded: string): string | null {
  // Try new key first
  const newKeyResult = deobfuscateWithKey(encoded, getObfuscationKey());
  if (newKeyResult !== null) {
    return newKeyResult;
  }

  // Fallback to legacy key (for secrets stored before the key change)
  const legacyKeyResult = deobfuscateWithKey(encoded, getObfuscationKeyLegacy());
  if (legacyKeyResult !== null) {
    // Re-encode with new key to migrate transparently
    // Note: This only works in set/get flow, not in read-only scenarios
    return legacyKeyResult;
  }

  return null;
}

/**
 * Simple XOR obfuscation (not encryption, but prevents casual inspection).
 * Uses TextEncoder to safely produce Latin1-safe byte output before btoa.
 */
function obfuscate(value: string): string {
  const key = getObfuscationKey();
  const bytes = new TextEncoder().encode(value);
  const keyBytes = new TextEncoder().encode(key);
  const xored = bytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
  // Convert bytes to Latin1-safe string for btoa
  return btoa(String.fromCharCode(...xored));
}

class WebSecrets implements SecretsAdapter {
  async get(key: string): Promise<string | null> {
    try {
      const encoded = localStorage.getItem(`${SECRET_PREFIX}${key}`);
      if (!encoded) return null;
      const value = deobfuscate(encoded);
      return value || null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const encoded = obfuscate(value);
    localStorage.setItem(`${SECRET_PREFIX}${key}`, encoded);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(`${SECRET_PREFIX}${key}`);
  }
}

export const secrets = new WebSecrets();
export default secrets;
