// Simple in-memory cache with TTL support
interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class Cache {
  private cache = new Map<string, CacheItem<any>>();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  set<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void { // Default 5 minutes
    // Clean expired items if cache is getting full
    if (this.cache.size >= this.maxSize) {
      this.cleanup();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    
    if (!item) {
      return null;
    }

    // Check if item has expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return null;
    }

    return item.data as T;
  }

  has(key: string): boolean {
    const item = this.cache.get(key);
    
    if (!item) {
      return false;
    }

    // Check if item has expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Clean up expired items
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        this.cache.delete(key);
      }
    }
  }

  // Get cache statistics
  getStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  // Get all keys (for debugging)
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

// Create singleton instances for different cache types
export const responseCache = new Cache(500); // For API responses
export const templateCache = new Cache(100); // For code templates
export const fileCache = new Cache(200); // For file contents
export const projectCache = new Cache(50); // For project structures

// Utility functions for common caching patterns
export const cacheKey = {
  // API response keys
  llmResponse: (provider: string, model: string, prompt: string) => 
    `llm:${provider}:${model}:${btoa(prompt).slice(0, 50)}`,
  
  // Template keys
  codeTemplate: (language: string, type: string) => 
    `template:${language}:${type}`,
  
  // File keys
  fileContent: (path: string) => 
    `file:${path}`,
  
  // Project keys
  projectStructure: (files: string[]) => 
    `project:${files.sort().join(',')}`,
  
  // GitHub keys
  githubRepo: (owner: string, repo: string) => 
    `github:${owner}:${repo}`,
  
  // HuggingFace keys
  hfModel: (modelId: string) => 
    `hf:${modelId}`,
};

// Cache decorators for functions
export function cached<T extends (...args: any[]) => any>(
  cache: Cache,
  keyGenerator: (...args: Parameters<T>) => string,
  ttl?: number
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: Parameters<T>) {
      const key = keyGenerator(...args);
      
      // Try to get from cache first
      const cached = cache.get(key);
      if (cached !== null) {
        return cached;
      }

      // Execute original method
      const result = await method.apply(this, args);
      
      // Cache the result
      cache.set(key, result, ttl);
      
      return result;
    };

    return descriptor;
  };
}

// Persistent cache using localStorage (for client-side)
export class PersistentCache {
  private prefix: string;
  private maxAge: number;

  constructor(prefix: string = 'binG_cache_', maxAge: number = 24 * 60 * 60 * 1000) { // Default 24 hours
    this.prefix = prefix;
    this.maxAge = maxAge;
  }

  set<T>(key: string, data: T): void {
    try {
      const item = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(this.prefix + key, JSON.stringify(item));
    } catch (error) {
      console.warn('Failed to save to localStorage:', error);
    }
  }

  get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(this.prefix + key);
      if (!item) return null;

      const parsed = JSON.parse(item);
      
      // Check if expired
      if (Date.now() - parsed.timestamp > this.maxAge) {
        this.delete(key);
        return null;
      }

      return parsed.data as T;
    } catch (error) {
      console.warn('Failed to read from localStorage:', error);
      return null;
    }
  }

  delete(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch (error) {
      console.warn('Failed to delete from localStorage:', error);
    }
  }

  clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Failed to clear localStorage:', error);
    }
  }
}

// Create persistent cache instances
export const userPrefsCache = new PersistentCache('binG_prefs_');
export const chatHistoryCache = new PersistentCache('binG_history_', 7 * 24 * 60 * 60 * 1000); // 7 days
export const providerCache = new PersistentCache('binG_providers_', 60 * 60 * 1000); // 1 hour

// Auto-cleanup function to run periodically
export const startCacheCleanup = () => {
  const cleanup = () => {
    responseCache.cleanup();
    templateCache.cleanup();
    fileCache.cleanup();
    projectCache.cleanup();
  };

  // Run cleanup every 5 minutes
  setInterval(cleanup, 5 * 60 * 1000);
  
  // Run initial cleanup
  cleanup();
};

// Export default cache instance
export default responseCache;