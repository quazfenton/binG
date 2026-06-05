/**
 * Tests for the stable anonymous identity service.
 *
 * Covers:
 *  - SSR placeholder is distinct from real anon IDs
 *  - localStorage wins over cookie
 *  - Cookie wins when localStorage is missing
 *  - Generation persists to BOTH stores
 *  - Format validation rejects malformed values
 *  - clearAnonUserId() purges both stores
 *  - hasPersistedIdentity() returns the right answer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Vitest's default environment is `node`, which has no `window` or
// `document`. We polyfill the minimum the SUT touches so we can run
// these tests in isolation.
function ensureBrowserGlobals() {
  if (typeof (globalThis as any).localStorage !== 'undefined') return;

  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as any).localStorage = localStorage;

  // Cookie jar keyed by name.
  const cookies = new Map<string, string>();
  const document = {
    get cookie() {
      return Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    },
    set cookie(value: string) {
      // Empty assignment = clear (matches our beforeEach pattern)
      if (value === '' || value === undefined) {
        cookies.clear();
        return;
      }
      const eq = value.indexOf('=');
      const head = (eq > -1 ? value.slice(0, eq) : value).trim();
      if (/expires=Thu, 01 Jan 1970/.test(value)) {
        cookies.delete(head);
        return;
      }
      // Strip the leading "name=" so we store just the value.
      const stored = eq > -1 ? value.slice(eq + 1).split(';')[0] : '';
      cookies.set(head, stored);
    },
  };
  (globalThis as any).document = document;

  (globalThis as any).window = { localStorage };
}

ensureBrowserGlobals();

/**
 * The SUT captures nothing at import time, so re-importing it between
 * tests is cheap and gives us a clean module state.
 */
async function freshImport() {
  vi.resetModules();
  return import('../anon-identity');
}

describe('anon-identity', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    (globalThis as any).document.cookie = '';
    (globalThis as any).window = {
      localStorage: (globalThis as any).localStorage,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a distinct SSR placeholder when window is undefined', async () => {
    const originalWindow = (globalThis as any).window;
    // @ts-expect-error - intentionally removing window
    delete (globalThis as any).window;
    try {
      const mod = await freshImport();
      const id = mod.getAnonUserId();
      expect(id.startsWith('anon_ssr_')).toBe(true);
      expect(id).toBe('anon_ssr_placeholder');
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it('generates a new id and persists to localStorage AND cookie', async () => {
    const mod = await freshImport();
    const id = mod.getAnonUserId();
    expect(id).toMatch(/^anon_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect((globalThis as any).localStorage.getItem('bing-anon-user-id')).toBe(id);
    expect((globalThis as any).document.cookie).toContain('bing_anon_uid=' + id);
  });

  it('returns the same id on subsequent calls (stable within a session)', async () => {
    const mod = await freshImport();
    const a = mod.getAnonUserId();
    const b = mod.getAnonUserId();
    expect(a).toBe(b);
  });

  it('rehydrates from localStorage when present', async () => {
    (globalThis as any).localStorage.setItem(
      'bing-anon-user-id',
      'anon_aabbccdd-1111-2222-3333-444455556666',
    );
    const mod = await freshImport();
    expect(mod.getAnonUserId()).toBe('anon_aabbccdd-1111-2222-3333-444455556666');
  });

  it('rehydrates from cookie when localStorage is missing', async () => {
    (globalThis as any).document.cookie = `bing_anon_uid=anon_12345678-1234-1234-1234-123456789abc`;
    const mod = await freshImport();
    expect(mod.getAnonUserId()).toBe('anon_12345678-1234-1234-1234-123456789abc');
    expect((globalThis as any).localStorage.getItem('bing-anon-user-id')).toBe(
      'anon_12345678-1234-1234-1234-123456789abc',
    );
  });

  it('prefers localStorage over cookie', async () => {
    (globalThis as any).localStorage.setItem(
      'bing-anon-user-id',
      'anon_aabbccdd-1111-2222-3333-444455556666',
    );
    (globalThis as any).document.cookie = `bing_anon_uid=anon_99999999-9999-9999-9999-999999999999`;
    const mod = await freshImport();
    expect(mod.getAnonUserId()).toBe('anon_aabbccdd-1111-2222-3333-444455556666');
  });

  it('rejects malformed localStorage values and re-generates', async () => {
    (globalThis as any).localStorage.setItem('bing-anon-user-id', 'garbage');
    const mod = await freshImport();
    const id = mod.getAnonUserId();
    expect(id).not.toBe('garbage');
    expect(id).toMatch(/^anon_/);
  });

  it('rejects malformed cookie values and re-generates', async () => {
    (globalThis as any).document.cookie = `bing_anon_uid=garbage`;
    const mod = await freshImport();
    const id = mod.getAnonUserId();
    expect(id).not.toBe('garbage');
    expect(id).toMatch(/^anon_/);
  });

  it('heals a missing cookie when localStorage is set', async () => {
    (globalThis as any).localStorage.setItem(
      'bing-anon-user-id',
      'anon_aabbccdd-1111-2222-3333-444455556666',
    );
    (globalThis as any).document.cookie = '';
    const mod = await freshImport();
    mod.getAnonUserId();
    expect((globalThis as any).document.cookie).toContain(
      'bing_anon_uid=anon_aabbccdd-1111-2222-3333-444455556666',
    );
  });

  it('clearAnonUserId purges both stores', async () => {
    const mod = await freshImport();
    mod.getAnonUserId();
    expect(mod.hasPersistedIdentity()).toBe(true);
    mod.clearAnonUserId();
    expect(mod.hasPersistedIdentity()).toBe(false);
  });

  it('hasPersistedIdentity returns true for localStorage-only', async () => {
    (globalThis as any).localStorage.setItem(
      'bing-anon-user-id',
      'anon_aabbccdd-1111-2222-3333-444455556666',
    );
    const mod = await freshImport();
    expect(mod.hasPersistedIdentity()).toBe(true);
  });

  it('hasPersistedIdentity returns true for cookie-only', async () => {
    (globalThis as any).document.cookie = `bing_anon_uid=anon_aabbccdd-1111-2222-3333-444455556666`;
    const mod = await freshImport();
    expect(mod.hasPersistedIdentity()).toBe(true);
  });

  it('hasPersistedIdentity returns false when neither is set', async () => {
    const mod = await freshImport();
    expect(mod.hasPersistedIdentity()).toBe(false);
  });

  it('uses the manual UUID v4 fallback when crypto.randomUUID is unavailable', async () => {
    const originalRandomUUID = (globalThis as any).crypto?.randomUUID;
    (globalThis as any).localStorage.clear();
    (globalThis as any).document.cookie = '';
    if ((globalThis as any).crypto) {
      // @ts-expect-error - intentional removal
      delete (globalThis as any).crypto.randomUUID;
    }
    try {
      const mod = await freshImport();
      const id = mod.getAnonUserId();
      expect(id).toMatch(/^anon_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    } finally {
      if (originalRandomUUID && (globalThis as any).crypto) {
        (globalThis as any).crypto.randomUUID = originalRandomUUID;
      }
    }
  });

  it('uses the timestamp fallback when crypto is entirely unavailable', async () => {
    const originalCrypto = (globalThis as any).crypto;
    // Clear all storage so we know we're generating a fresh ID
    (globalThis as any).localStorage.clear();
    (globalThis as any).document.cookie = '';
    // @ts-expect-error - intentional removal
    delete (globalThis as any).crypto;
    try {
      const mod = await freshImport();
      const id = mod.getAnonUserId();
      expect(id).toMatch(/^anon_[0-9a-z]+_[0-9a-z]+$/);
    } finally {
      (globalThis as any).crypto = originalCrypto;
    }
  });
});
