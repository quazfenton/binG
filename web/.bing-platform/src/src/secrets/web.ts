/**
 * Web Secrets Implementation
 *
 * Stores user secrets (auth tokens, API keys) encrypted in IndexedDB
 * using AES-GCM with a PBKDF2-derived key.
 *
 * ⚠️  SECURITY WARNING (HIGH-1): This encryption is **obfuscation, not true security**.
 * An attacker with browser access (XSS, devtools, physical access) can:
 *   1. Read the salt from IndexedDB META_STORE
 *   2. Extract the hardcoded pepper from the JavaScript bundle
 *   3. Derive the AES key locally and decrypt all stored secrets
 *
 * This protects against casual inspection only. For production-grade security,
 * keep secrets server-side and use short-lived tokens.
 *
 * Security model (defense-in-depth, NOT confidentiality guarantee):
 * - A random salt is generated per browser profile
 * - A fixed "pepper" is combined with the salt via PBKDF2 to derive the AES key
 * - The key material is stored separately from encrypted ciphertext in IndexedDB
 * - This prevents casual inspection and raises the bar significantly over XOR obfuscation
 *
 * Note: True client-side security is limited — a motivated attacker with
 * browser access can extract keys. For production-grade security, keep
 * secrets server-side and use short-lived tokens.
 */

export interface SecretsAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const DB_NAME = 'bing-secrets';
const DB_VERSION = 1;
const SECRET_STORE = 'secrets';
const META_STORE = 'meta';
const META_KEY_SALT = 'pbkdf2-salt';
const META_KEY_PEPPER = 'pepper';

// Fixed pepper string embedded in code — adds a layer of defense-in-depth.
// An attacker would need both this value AND the stored salt to derive the key.
const HARDCODED_PEPPER = 'binG-web-secrets-pepper-v1-do-not-rely-on-this-alone';

/* ─── IndexedDB helpers ─── */

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SECRET_STORE)) {
        db.createObjectStore(SECRET_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/* ─── Crypto helpers ─── */

function toArrayBuffer(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf);
}

/** Generate a random salt */
function generateSalt(length = 16): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Derive an AES-GCM CryptoKey from salt + pepper via PBKDF2 */
async function deriveKey(salt: Uint8Array, pepper: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt plaintext with AES-GCM, return { iv, ciphertext } as base64 strings */
async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );

  // Pack IV + ciphertext into a single base64 blob
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(toArrayBuffer(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/** Decrypt an AES-GCM ciphertext produced by encrypt() */
async function decrypt(packed: string, key: CryptoKey): Promise<string | null> {
  try {
    const raw = atob(packed);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i) & 0xff;
    }

    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/* ─── Key material management ─── */

interface KeyMaterial {
  salt: number[]; // stored as array for JSON compat
  pepper: string;
}

/**
 * Get or create key material stored in IndexedDB meta store.
 * Created once on first use; reused thereafter.
 */
async function getKeyMaterial(db: IDBDatabase): Promise<KeyMaterial> {
  let meta = await idbGet<KeyMaterial>(db, META_STORE, META_KEY_SALT);

  if (!meta) {
    meta = {
      salt: Array.from(generateSalt()),
      pepper: HARDCODED_PEPPER,
    };
    await idbPut(db, META_STORE, META_KEY_SALT, meta);
  }

  return meta;
}

async function getCryptoKey(db: IDBDatabase): Promise<CryptoKey> {
  const { salt, pepper } = await getKeyMaterial(db);
  return deriveKey(new Uint8Array(salt), pepper);
}

/* ─── Migration: read old XOR-obfuscated values from localStorage ─── */

const SECRET_PREFIX = '__sec__';

/**
 * Derive obfuscation key (legacy, for migration only)
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

function deobfuscateWithKey(encoded: string, key: string): string | null {
  try {
    const decoded = atob(encoded);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    const keyBytes = new TextEncoder().encode(key);
    const xored = bytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
    const result = new TextDecoder().decode(xored);
    if (!result || result.length === 0) return null;
    return result;
  } catch {
    return null;
  }
}

function deobfuscateLegacy(encoded: string): string | null {
  return deobfuscateWithKey(encoded, getObfuscationKeyLegacy());
}

/* ─── WebSecrets class ─── */

class WebSecrets implements SecretsAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private cryptoKeyPromise: Promise<CryptoKey> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB();
    }
    return this.dbPromise;
  }

  private async getKey(): Promise<CryptoKey> {
    if (!this.cryptoKeyPromise) {
      this.cryptoKeyPromise = this.getDB().then(getCryptoKey);
    }
    return this.cryptoKeyPromise;
  }

  async get(key: string): Promise<string | null> {
    try {
      const db = await this.getDB();
      const encrypted = await idbGet<string>(db, SECRET_STORE, key);

      if (encrypted) {
        const cryptoKey = await this.getKey();
        const plaintext = await decrypt(encrypted, cryptoKey);
        if (plaintext !== null) return plaintext;
      }

      // Migration fallback: check legacy localStorage
      const legacyEncoded =
        typeof window !== 'undefined'
          ? localStorage.getItem(`${SECRET_PREFIX}${key}`)
          : null;
      if (legacyEncoded) {
        const plaintext = deobfuscateLegacy(legacyEncoded);
        if (plaintext) {
          // Re-encrypt and store in new format
          await this.set(key, plaintext);
          localStorage.removeItem(`${SECRET_PREFIX}${key}`);
          return plaintext;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      // ⚠️ SECURITY WARNING: This stores secrets in browser-accessible storage.
      // Client-side encryption is obfuscation, NOT true security.
      // DO NOT use this for production root keys or high-value credentials.
      const db = await this.getDB();
      const cryptoKey = await this.getKey();
      const encrypted = await encrypt(value, cryptoKey);
      await idbPut(db, SECRET_STORE, key, encrypted);
    } catch (err) {
      console.error('[WebSecrets] Failed to set secret:', err instanceof Error ? err.message : String(err));
      throw new Error(`Failed to store secret "${key}": ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  async remove(key: string): Promise<void> {
    const db = await this.getDB();
    await idbDelete(db, SECRET_STORE, key);
    // Also clean up legacy key if present
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`${SECRET_PREFIX}${key}`);
    }
  }
}

export const secrets = new WebSecrets();
export default secrets;
