/**
 * Cache Manager
 * Advanced caching system for improved application responsiveness
 */

export interface CacheConfig {
  maxSize: number;
  defaultTTL: number;
  enablePersistence: boolean;
  enableCompression: boolean;
  enableEncryption: boolean;
}

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
  compressed?: boolean;
  encrypted?: boolean;
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
  evictionCount: number;
  compressionRatio: number;
}

export type CacheStrategy = 'LRU' | 'LFU' | 'FIFO' | 'TTL';

class CacheManager {
  private config: CacheConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = []; // For LRU
  private stats: CacheStats;
  private strategy: CacheStrategy = 'LRU';
  private persistenceKey = 'app-cache-v1';

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 50 * 1024 * 1024, // 50MB
      defaultTTL: 300000, // 5 minutes
      enablePersistence: true,
      enableCompression: true,
      enableEncryption: false,
      ...config
    };

    this.stats = {
      totalEntries: 0,
      totalSize: 0,
      hitRate: 0,
      missRate: 0,
      evictionCount: 0,
      compressionRatio: 0
    };

    this.loadPersistedCache();
    this.startCleanupTimer();
  }

  // Core cache operations
  set<T>(key: string, data: T, ttl?: number): void {
    const entry = this.createCacheEntry(data, ttl);
    
    // Check if we need to evict entries
    if (this.getCurrentSize() + entry.size > this.config.maxSize) {
      this.evictEntries(entry.size);
    }

    // Remove existing entry if it exists
    if (this.cache.has(key)) {
      this.removeFromAccessOrder(key);
      this.stats.totalSize -= this.cache.get(key)!.size;
    } else {
      this.stats.totalEntries++;
    }

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
    this.stats.totalSize += entry.size;

    if (this.config.enablePersistence) {
      this.persistCache();
    }
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.updateMissRate();
      return null;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.delete(key);
      this.updateMissRate();
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.updateAccessOrder(key);
    this.updateHitRate();

    return this.deserializeData(entry);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    return entry !== undefined && !this.isExpired(entry);
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.cache.delete(key);
    this.removeFromAccessOrder(key);
    this.stats.totalEntries--;
    this.stats.totalSize -= entry.size;

    if (this.config.enablePersistence) {
      this.persistCache();
    }

    return true;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.stats.totalEntries = 0;
    this.stats.totalSize = 0;
    this.stats.evictionCount = 0;

    if (this.config.enablePersistence) {
      this.clearPersistedCache();
    }
  }

  // Advanced caching features
  mget<T>(keys: string[]): Map<string, T | null> {
    const results = new Map<string, T | null>();
    
    for (const key of keys) {
      results.set(key, this.get<T>(key));
    }
    
    return results;
  }

  mset<T>(entries: Map<string, T>, ttl?: number): void {
    for (const [key, data] of entries) {
      this.set(key, data, ttl);
    }
  }

  // Cache with fallback function
  getOrSet<T>(key: string, fallback: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return Promise.resolve(cached);
    }

    return fallback().then(data => {
      this.set(key, data, ttl);
      return data;
    });
  }

  // Namespace support
  namespace(prefix: string): NamespacedCache {
    return new NamespacedCache(this, prefix);
  }

  // Cache warming
  warm(entries: Array<{ key: string; data: any; ttl?: number }>): void {
    for (const entry of entries) {
      this.set(entry.key, entry.data, entry.ttl);
    }
  }

  // Batch operations
  batchGet<T>(keys: string[]): Promise<Map<string, T | null>> {
    return Promise.resolve(this.mget<T>(keys));
  }

  batchSet<T>(entries: Array<{ key: string; data: T; ttl?: number }>): Promise<void> {
    for (const entry of entries) {
      this.set(entry.key, entry.data, entry.ttl);
    }
    return Promise.resolve();
  }

  // Private methods
  private createCacheEntry<T>(data: T, ttl?: number): CacheEntry<T> {
    const serializedData = this.serializeData(data);
    const size = this.calculateSize(serializedData);

    return {
      data: serializedData,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTTL,
      accessCount: 1,
      lastAccessed: Date.now(),
      size,
      compressed: this.config.enableCompression && size > 1024, // Compress if > 1KB
      encrypted: this.config.enableEncryption
    };
  }

  private serializeData<T>(data: T): any {
    if (this.config.enableCompression) {
      return this.compress(data);
    }
    return data;
  }

  private deserializeData<T>(entry: CacheEntry): T {
    if (entry.compressed && this.config.enableCompression) {
      return this.decompress(entry.data);
    }
    return entry.data;
  }

  private compress<T>(data: T): string {
    // Simple compression using JSON + base64
    // In production, you might want to use a proper compression library
    const jsonString = JSON.stringify(data);
    return btoa(jsonString);
  }

  private decompress<T>(compressedData: string): T {
    const jsonString = atob(compressedData);
    return JSON.parse(jsonString);
  }

  private calculateSize(data: any): number {
    if (typeof data === 'string') {
      return new Blob([data]).size;
    }
    return new Blob([JSON.stringify(data)]).size;
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private evictEntries(requiredSpace: number): void {
    let freedSpace = 0;
    
    while (freedSpace < requiredSpace && this.cache.size > 0) {
      const keyToEvict = this.selectEvictionCandidate();
      if (!keyToEvict) break;

      const entry = this.cache.get(keyToEvict);
      if (entry) {
        freedSpace += entry.size;
        this.delete(keyToEvict);
        this.stats.evictionCount++;
      }
    }
  }

  private selectEvictionCandidate(): string | null {
    switch (this.strategy) {
      case 'LRU':
        return this.accessOrder[0] || null;
      
      case 'LFU':
        let leastUsed = null;
        let minAccess = Infinity;
        for (const [key, entry] of this.cache) {
          if (entry.accessCount < minAccess) {
            minAccess = entry.accessCount;
            leastUsed = key;
          }
        }
        return leastUsed;
      
      case 'FIFO':
        return this.cache.keys().next().value || null;
      
      case 'TTL':
        // Find entry that expires soonest
        let soonestExpiry = null;
        let minTTL = Infinity;
        for (const [key, entry] of this.cache) {
          const remainingTTL = entry.ttl - (Date.now() - entry.timestamp);
          if (remainingTTL < minTTL) {
            minTTL = remainingTTL;
            soonestExpiry = key;
          }
        }
        return soonestExpiry;
      
      default:
        return this.accessOrder[0] || null;
    }
  }

  private getCurrentSize(): number {
    return this.stats.totalSize;
  }

  private updateHitRate(): void {
    // Simple hit rate calculation
    this.stats.hitRate = (this.stats.hitRate * 0.9) + (1 * 0.1);
  }

  private updateMissRate(): void {
    this.stats.missRate = (this.stats.missRate * 0.9) + (1 * 0.1);
  }

  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000); // Clean up every minute
  }

  private cleanupExpiredEntries(): void {
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.delete(key);
    }
  }

  // Persistence methods
  private loadPersistedCache(): void {
    if (!this.config.enablePersistence || typeof localStorage === 'undefined') {
      return;
    }

    try {
      const persistedData = localStorage.getItem(this.persistenceKey);
      if (persistedData) {
        const parsed = JSON.parse(persistedData);
        for (const [key, entry] of Object.entries(parsed)) {
          if (!this.isExpired(entry as CacheEntry)) {
            this.cache.set(key, entry as CacheEntry);
            this.updateAccessOrder(key);
            this.stats.totalEntries++;
            this.stats.totalSize += (entry as CacheEntry).size;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load persisted cache:', error);
    }
  }

  private persistCache(): void {
    if (!this.config.enablePersistence || typeof localStorage === 'undefined') {
      return;
    }

    try {
      const cacheObject = Object.fromEntries(this.cache);
      localStorage.setItem(this.persistenceKey, JSON.stringify(cacheObject));
    } catch (error) {
      console.warn('Failed to persist cache:', error);
    }
  }

  private clearPersistedCache(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.persistenceKey);
    }
  }

  // Public API methods
  getStats(): CacheStats {
    return { ...this.stats };
  }

  setStrategy(strategy: CacheStrategy): void {
    this.strategy = strategy;
  }

  getStrategy(): CacheStrategy {
    return this.strategy;
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  values<T>(): T[] {
    return Array.from(this.cache.values()).map(entry => this.deserializeData(entry));
  }

  entries<T>(): Array<[string, T]> {
    return Array.from(this.cache.entries()).map(([key, entry]) => [
      key,
      this.deserializeData(entry)
    ]);
  }

  size(): number {
    return this.cache.size;
  }

  memoryUsage(): number {
    return this.getCurrentSize();
  }
}

// Namespaced cache for organizing cache entries
class NamespacedCache {
  constructor(private cacheManager: CacheManager, private prefix: string) {}

  private getKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  set<T>(key: string, data: T, ttl?: number): void {
    this.cacheManager.set(this.getKey(key), data, ttl);
  }

  get<T>(key: string): T | null {
    return this.cacheManager.get<T>(this.getKey(key));
  }

  has(key: string): boolean {
    return this.cacheManager.has(this.getKey(key));
  }

  delete(key: string): boolean {
    return this.cacheManager.delete(this.getKey(key));
  }

  clear(): void {
    const keys = this.cacheManager.keys();
    const namespacedKeys = keys.filter(key => key.startsWith(`${this.prefix}:`));
    
    for (const key of namespacedKeys) {
      this.cacheManager.delete(key);
    }
  }

  getOrSet<T>(key: string, fallback: () => Promise<T>, ttl?: number): Promise<T> {
    return this.cacheManager.getOrSet(this.getKey(key), fallback, ttl);
  }
}

export const cacheManager = new CacheManager();
export { CacheManager };
export default CacheManager;