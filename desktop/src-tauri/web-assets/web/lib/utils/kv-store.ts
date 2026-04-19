/**
 * Key-Value Store Provider
 *
 * Provides persistent storage for memory.store/memory.retrieve capabilities.
 * Supports multiple backends:
 * - In-memory (development)
 * - Redis (production)
 * - SQLite (persistent local)
 *
 * @example
 * ```typescript
 * import { kvStore } from '@/lib/utils/kv-store';
 *
 * // Store a value
 * await kvStore.set('user:123:preferences', { theme: 'dark' });
 *
 * // Retrieve a value
 * const prefs = await kvStore.get('user:123:preferences');
 *
 * // Search by pattern
 * const keys = await kvStore.keys('user:123:*');
 * ```
 */

import { createLogger } from './logger';

const logger = createLogger('KVStore');

export interface KVStoreConfig {
  backend: 'memory' | 'redis' | 'sqlite';
  redisUrl?: string;
  sqlitePath?: string;
  defaultTTL?: number; // Default TTL in seconds
  namespace?: string;  // Global namespace prefix
}

export interface KVStoreEntry {
  key: string;
  value: any;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface KVStoreSearchResult {
  key: string;
  value: any;
  score?: number;
  timestamp: string;
}

/**
 * Key-Value Store Interface
 */
export interface KVStore {
  /**
   * Store a value
   */
  set(key: string, value: any, options?: { ttl?: number; namespace?: string }): Promise<void>;
  
  /**
   * Retrieve a value by key
   */
  get(key: string, options?: { namespace?: string }): Promise<any>;
  
  /**
   * Delete a key
   */
  delete(key: string, options?: { namespace?: string }): Promise<boolean>;
  
  /**
   * Search by pattern or query
   */
  search(query: string, options?: { namespace?: string; limit?: number }): Promise<KVStoreSearchResult[]>;
  
  /**
   * List keys matching pattern
   */
  keys(pattern: string, options?: { namespace?: string }): Promise<string[]>;
  
  /**
   * Check if key exists
   */
  has(key: string, options?: { namespace?: string }): Promise<boolean>;
  
  /**
   * Clear all entries (optionally by namespace)
   */
  clear(namespace?: string): Promise<void>;
}

/**
 * In-Memory KV Store Implementation
 */
class MemoryKVStore implements KVStore {
  private store = new Map<string, KVStoreEntry>();
  private defaultTTL?: number;
  private namespace?: string;

  constructor(config?: { defaultTTL?: number; namespace?: string }) {
    this.defaultTTL = config?.defaultTTL;
    this.namespace = config?.namespace;
    
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);
  }

  private getKey(key: string, namespace?: string): string {
    const ns = namespace || this.namespace || 'default';
    return `${ns}:${key}`;
  }

  private isExpired(entry: KVStoreEntry): boolean {
    return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    let deleted = 0;
    
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        deleted++;
      }
    }
    
    if (deleted > 0) {
      logger.debug(`Cleaned up ${deleted} expired entries`);
    }
  }

  async set(key: string, value: any, options?: { ttl?: number; namespace?: string }): Promise<void> {
    const fullKey = this.getKey(key, options?.namespace);
    const ttl = options?.ttl || this.defaultTTL;
    const now = Date.now();
    
    this.store.set(fullKey, {
      key: fullKey,
      value,
      expiresAt: ttl ? now + (ttl * 1000) : undefined,
      createdAt: now,
      updatedAt: now,
    });
    
    logger.debug(`Stored key: ${fullKey}`, { ttl, hasValue: value !== undefined });
  }

  async get(key: string, options?: { namespace?: string }): Promise<any> {
    const fullKey = this.getKey(key, options?.namespace);
    const entry = this.store.get(fullKey);
    
    if (!entry) {
      return null;
    }
    
    if (this.isExpired(entry)) {
      this.store.delete(fullKey);
      return null;
    }
    
    return entry.value;
  }

  async delete(key: string, options?: { namespace?: string }): Promise<boolean> {
    const fullKey = this.getKey(key, options?.namespace);
    return this.store.delete(fullKey);
  }

  async search(query: string, options?: { namespace?: string; limit?: number }): Promise<KVStoreSearchResult[]> {
    const namespace = options?.namespace || this.namespace || 'default';
    const limit = options?.limit || 10;
    const queryLower = query.toLowerCase();
    
    const results: KVStoreSearchResult[] = [];
    
    for (const [key, entry] of this.store.entries()) {
      if (!key.startsWith(`${namespace}:`)) {
        continue;
      }
      
      if (this.isExpired(entry)) {
        continue;
      }
      
      // Simple text search in key and value
      const keyMatch = key.toLowerCase().includes(queryLower);
      const valueMatch = typeof entry.value === 'string' && 
                         entry.value.toLowerCase().includes(queryLower);
      
      if (keyMatch || valueMatch) {
        results.push({
          key: entry.key,
          value: entry.value,
          score: keyMatch ? 1.0 : 0.5,
          timestamp: new Date(entry.createdAt).toISOString(),
        });
      }
      
      if (results.length >= limit) {
        break;
      }
    }
    
    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  async keys(pattern: string, options?: { namespace?: string }): Promise<string[]> {
    const namespace = options?.namespace || this.namespace || 'default';
    const prefix = `${namespace}:${pattern.replace(/\*/g, '')}`;
    const keys: string[] = [];
    
    for (const [key, entry] of this.store.entries()) {
      if (!key.startsWith(namespace)) {
        continue;
      }
      
      if (this.isExpired(entry)) {
        continue;
      }
      
      // Simple pattern matching (only supports * wildcard)
      if (pattern.includes('*')) {
        const regex = new RegExp(`^${namespace}:${pattern.replace(/\*/g, '.*')}$`);
        if (regex.test(key)) {
          keys.push(key);
        }
      } else if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    
    return keys;
  }

  async has(key: string, options?: { namespace?: string }): Promise<boolean> {
    const fullKey = this.getKey(key, options?.namespace);
    const entry = this.store.get(fullKey);
    
    if (!entry) {
      return false;
    }
    
    if (this.isExpired(entry)) {
      this.store.delete(fullKey);
      return false;
    }
    
    return true;
  }

  async clear(namespace?: string): Promise<void> {
    const ns = namespace || this.namespace || 'default';
    
    for (const key of this.store.keys()) {
      if (key.startsWith(`${ns}:`)) {
        this.store.delete(key);
      }
    }
    
    logger.info(`Cleared all entries for namespace: ${ns}`);
  }
}

/**
 * Redis KV Store Implementation (if Redis is available)
 */
class RedisKVStore implements KVStore {
  private redis: any;
  private defaultTTL?: number;
  private namespace?: string;

  constructor(redisClient: any, config?: { defaultTTL?: number; namespace?: string }) {
    this.redis = redisClient;
    this.defaultTTL = config?.defaultTTL;
    this.namespace = config?.namespace;
  }

  private getKey(key: string, namespace?: string): string {
    const ns = namespace || this.namespace || 'kv';
    return `${ns}:${key}`;
  }

  async set(key: string, value: any, options?: { ttl?: number; namespace?: string }): Promise<void> {
    const fullKey = this.getKey(key, options?.namespace);
    const ttl = options?.ttl || this.defaultTTL;
    
    await this.redis.set(fullKey, JSON.stringify(value));
    
    if (ttl) {
      await this.redis.expire(fullKey, ttl);
    }
    
    logger.debug(`Stored key in Redis: ${fullKey}`, { ttl });
  }

  async get(key: string, options?: { namespace?: string }): Promise<any> {
    const fullKey = this.getKey(key, options?.namespace);
    const data = await this.redis.get(fullKey);
    
    if (!data) {
      return null;
    }
    
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  async delete(key: string, options?: { namespace?: string }): Promise<boolean> {
    const fullKey = this.getKey(key, options?.namespace);
    const result = await this.redis.del(fullKey);
    return result > 0;
  }

  /**
   * Batch get multiple keys efficiently using MGET
   */
  async batchGet(keys: string[], options?: { namespace?: string }): Promise<Map<string, any>> {
    const namespace = options?.namespace || this.namespace || 'kv';
    const fullKeys = keys.map(k => this.getKey(k, namespace));
    
    if (fullKeys.length === 0) {
      return new Map();
    }

    // Use MGET for efficient batch retrieval
    const results = await this.redis.mget(fullKeys);
    const map = new Map<string, any>();

    results.forEach((data: any, i: number) => {
      if (data !== null && data !== undefined) {
        try {
          map.set(keys[i], JSON.parse(data));
        } catch {
          map.set(keys[i], data);
        }
      }
    });

    return map;
  }

  /**
   * Batch set multiple keys efficiently using pipeline
   */
  async batchSet(
    entries: Array<{ key: string; value: any; ttl?: number }>,
    options?: { namespace?: string }
  ): Promise<void> {
    const namespace = options?.namespace || this.namespace || 'kv';
    
    if (entries.length === 0) {
      return;
    }

    // Use pipeline for efficient batch write
    const pipeline = this.redis.pipeline();
    
    for (const { key, value, ttl } of entries) {
      const fullKey = this.getKey(key, namespace);
      pipeline.set(fullKey, JSON.stringify(value));
      
      if (ttl || this.defaultTTL) {
        pipeline.expire(fullKey, ttl || this.defaultTTL!);
      }
    }
    
    await pipeline.exec();
  }

  /**
   * Batch delete multiple keys efficiently using pipeline
   */
  async batchDelete(keys: string[], options?: { namespace?: string }): Promise<number> {
    const namespace = options?.namespace || this.namespace || 'kv';
    const fullKeys = keys.map(k => this.getKey(k, namespace));
    
    if (fullKeys.length === 0) {
      return 0;
    }

    // Use pipeline for efficient batch delete
    const pipeline = this.redis.pipeline();
    for (const fullKey of fullKeys) {
      pipeline.del(fullKey);
    }
    
    const results = await pipeline.exec();
    return results.reduce((sum: number, result: any) => sum + (result || 0), 0);
  }

  async search(query: string, options?: { namespace?: string; limit?: number }): Promise<KVStoreSearchResult[]> {
    // Redis doesn't support full-text search without RedisSearch
    // Fall back to pattern matching
    const namespace = options?.namespace || this.namespace || 'kv';
    const limit = options?.limit || 10;
    
    const keys = await this.redis.keys(`${namespace}:*`);
    const results: KVStoreSearchResult[] = [];
    
    for (const key of keys.slice(0, limit * 2)) {
      const data = await this.redis.get(key);
      if (!data) continue;
      
      const keyMatch = key.toLowerCase().includes(query.toLowerCase());
      
      results.push({
        key,
        value: JSON.parse(data),
        score: keyMatch ? 1.0 : 0.3,
        timestamp: new Date().toISOString(),
      });
    }
    
    return results.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  }

  async keys(pattern: string, options?: { namespace?: string }): Promise<string[]> {
    const namespace = options?.namespace || this.namespace || 'kv';
    return await this.redis.keys(`${namespace}:${pattern}`);
  }

  async has(key: string, options?: { namespace?: string }): Promise<boolean> {
    const fullKey = this.getKey(key, options?.namespace);
    const result = await this.redis.exists(fullKey);
    return result > 0;
  }

  async clear(namespace?: string): Promise<void> {
    const ns = namespace || this.namespace || 'kv';
    const keys = await this.redis.keys(`${ns}:*`);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    
    logger.info(`Cleared all Redis entries for namespace: ${ns}`);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let kvStoreInstance: KVStore | null = null;

/**
 * Get or create KV store instance
 */
export function getKVStore(config?: KVStoreConfig): KVStore {
  if (kvStoreInstance) {
    return kvStoreInstance;
  }

  const effectiveConfig: KVStoreConfig = {
    backend: 'memory',
    defaultTTL: 3600, // 1 hour default
    namespace: 'app',
    ...config,
  };

  // Try to use Redis if configured
  if (effectiveConfig.backend === 'redis' || process.env.REDIS_URL) {
    try {
      const redisUrl = effectiveConfig.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
      
      // Dynamic import to avoid Redis dependency if not used
      const Redis = require('ioredis');
      const redisClient = new Redis(redisUrl);
      
      kvStoreInstance = new RedisKVStore(redisClient, {
        defaultTTL: effectiveConfig.defaultTTL,
        namespace: effectiveConfig.namespace,
      });
      
      logger.info('Using Redis KV store', { url: redisUrl });
      return kvStoreInstance;
    } catch (error: any) {
      logger.warn('Failed to initialize Redis KV store, falling back to memory', error.message);
    }
  }

  // Default to in-memory store
  kvStoreInstance = new MemoryKVStore({
    defaultTTL: effectiveConfig.defaultTTL,
    namespace: effectiveConfig.namespace,
  });
  
  logger.info('Using in-memory KV store');
  return kvStoreInstance;
}

/**
 * Convenience exports
 */
export const kvStore = getKVStore();
export const memoryKVStore = new MemoryKVStore();
