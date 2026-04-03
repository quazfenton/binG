type StoredUrl = {
  id: string;
  original: string;
  clicks: number;
  created: string;
  lastAccessed: number;
};

// Maximum number of URLs to keep in memory (LRU eviction)
// Guard against invalid env values - default to 10000 if non-numeric or non-positive
const MAX_STORE_SIZE = (() => {
  const envValue = process.env.URL_SHORTENER_MAX_STORE_SIZE;
  if (!envValue) return 10000;
  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(`Invalid URL_SHORTENER_MAX_STORE_SIZE: "${envValue}". Using default 10000.`);
    return 10000;
  }
  return Math.min(parsed, 1000000); // Cap at 1M to prevent memory exhaustion
})();

declare global {
  // eslint-disable-next-line no-var
  var __urlShortenerStore: Map<string, StoredUrl> | undefined;
}

const store = globalThis.__urlShortenerStore ?? new Map<string, StoredUrl>();
if (!globalThis.__urlShortenerStore) {
  globalThis.__urlShortenerStore = store;
}

/**
 * Get a URL by ID and update last accessed time for LRU tracking.
 */
export function getUrl(id: string): StoredUrl | undefined {
  const url = store.get(id);
  if (url) {
    // Update last accessed time
    url.lastAccessed = Date.now();
    store.set(id, url);
  }
  return url;
}

/**
 * Set a URL with LRU eviction if store is at capacity.
 */
export function setUrl(id: string, url: Omit<StoredUrl, 'lastAccessed'>): StoredUrl {
  // If store is at capacity, evict least recently used entries
  if (store.size >= MAX_STORE_SIZE && !store.has(id)) {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, value] of store.entries()) {
      if (value.lastAccessed < oldestTime) {
        oldestTime = value.lastAccessed;
        oldestId = key;
      }
    }
    
    if (oldestId) {
      store.delete(oldestId);
    }
  }
  
  const storedUrl: StoredUrl = { ...url, lastAccessed: Date.now() };
  store.set(id, storedUrl);
  return storedUrl;
}

/**
 * Increment click count for a URL.
 */
export function incrementClicks(id: string): StoredUrl | undefined {
  const url = store.get(id);
  if (url) {
    url.clicks++;
    url.lastAccessed = Date.now();
    store.set(id, url);
    return url;
  }
  return undefined;
}

/**
 * Get all URLs (for admin/listing purposes).
 */
export function getAllUrls(): StoredUrl[] {
  return Array.from(store.values());
}

/**
 * Get current store size.
 */
export function getSize(): number {
  return store.size;
}

export const urlShortenerStore = store;
export type { StoredUrl };
