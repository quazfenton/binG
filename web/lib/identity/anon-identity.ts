/**
 * Anonymous Identity Service
 *
 * Provides a stable, persistent user ID for anonymous users.
 * Storage strategy (in order of priority):
 *   1. localStorage  -> survives refreshes, tab close
 *   2. Cookie        -> survives localStorage clears, works across subdomains
 *   3. Generated     -> created once and persisted to BOTH
 *
 * Why a cookie fallback?
 *   Aggressive browser "clear data" or privacy modes may wipe localStorage
 *   but cookies (especially non-HttpOnly ones set by JS) often survive.
 *   Persisting to both gives the best chance of recovery.
 */

const ANON_ID_KEY = 'bing-anon-user-id';
const ANON_COOKIE_NAME = 'bing_anon_uid';
const ANON_COOKIE_DAYS = 365; // ~1 year persistence

/**
 * Generate a new anonymous user ID.
 * Uses crypto.randomUUID() if available, falls back to a manual UUID v4.
 */
function generateAnonId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `anon_${crypto.randomUUID()}`;
  }
  // Fallback UUID v4 using crypto.getRandomValues
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Set version (4) and variant (10xx) per RFC 4122
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `anon_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  // Last resort: timestamp-based ID (still unique enough for anon sessions)
  return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Set a cookie with the given name, value, and expiration in days.
 */
function setCookie(name: string, value: string, days: number): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

/**
 * Get a cookie value by name.
 */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Get the current anonymous user ID, creating and persisting one if needed.
 * This is the main function to call from anywhere in the app.
 */
export function getAnonUserId(): string {
  if (typeof window === 'undefined') {
    // SSR context - return a placeholder. Real ID will be generated on the client.
    return 'ssr_placeholder';
  }

  // 1. Try localStorage
  try {
    const stored = localStorage.getItem(ANON_ID_KEY);
    if (stored && stored.startsWith('anon_')) {
      // Ensure cookie is in sync (heal if missing)
      if (getCookie(ANON_COOKIE_NAME) !== stored) {
        setCookie(ANON_COOKIE_NAME, stored, ANON_COOKIE_DAYS);
      }
      return stored;
    }
  } catch {
    // localStorage blocked (e.g., Safari private mode)
  }

  // 2. Try cookie
  const fromCookie = getCookie(ANON_COOKIE_NAME);
  if (fromCookie && fromCookie.startsWith('anon_')) {
    try {
      localStorage.setItem(ANON_ID_KEY, fromCookie);
    } catch {
      // Ignore
    }
    return fromCookie;
  }

  // 3. Generate new and persist to BOTH
  const newId = generateAnonId();
  try {
    localStorage.setItem(ANON_ID_KEY, newId);
  } catch {
    // Ignore
  }
  setCookie(ANON_COOKIE_NAME, newId, ANON_COOKIE_DAYS);
  return newId;
}

/**
 * Explicitly clear the anonymous identity (e.g., for "Sign Out" or "Reset Session").
 */
export function clearAnonUserId(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ANON_ID_KEY);
  } catch {
    // Ignore
  }
  setCookie(ANON_COOKIE_NAME, '', -1); // Expire immediately
}

/**
 * Check if the user currently has a persisted identity.
 * Useful for showing a "Welcome back" message.
 */
export function hasPersistedIdentity(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(ANON_ID_KEY)) return true;
  } catch {
    // Ignore
  }
  if (getCookie(ANON_COOKIE_NAME)) return true;
  return false;
}
