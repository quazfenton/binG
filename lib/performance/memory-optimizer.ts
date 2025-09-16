/**
 * Memory Optimizer
 * Advanced memory management and optimization system
 */

export interface MemoryOptimizationConfig {
  maxHeapSize: number;
  gcThreshold: number;
  cacheMaxSize: number;
  componentPoolSize: number;
  enableWeakReferences: boolean;
  enableObjectPooling: boolean;
}

export interface OptimizationResult {
  memoryFreed: number;
  objectsPooled: number;
  cacheCleared: number;
  weakReferencesCreated: number;
}

class MemoryOptimizer {
  private config: MemoryOptimizationConfig;
  private objectPools: Map<string, any[]> = new Map();
  private weakReferences: WeakMap<object, any> = new WeakMap();
  private cacheStore: Map<string, { data: any; timestamp: number; size: number }> = new Map();
  private componentInstances: WeakSet<any> = new WeakSet();
  private memoryPressureCallbacks: Set<() => void> = new Set();

  constructor(config: Partial<MemoryOptimizationConfig> = {}) {
    this.config = {
      maxHeapSize: 100 * 1024 * 1024, // 100MB
      gcThreshold: 80 * 1024 * 1024,  // 80MB
      cacheMaxSize: 50 * 1024 * 1024, // 50MB
      componentPoolSize: 100,
      enableWeakReferences: true,
      enableObjectPooling: true,
      ...config
    };

    this.setupMemoryPressureHandling();
    this.startMemoryMonitoring();
  }

  private setupMemoryPressureHandling(): void {
    if (typeof window === 'undefined') return;

    // Listen for memory pressure events
    if ('memory' in performance) {
      setInterval(() => {
        const memory = (performance as any).memory;
        if (memory.usedJSHeapSize > this.config.gcThreshold) {
          this.handleMemoryPressure();
        }
      }, 5000);
    }

    // Page visibility change optimization
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.optimizeForBackground();
      } else {
        this.optimizeForForeground();
      }
    });
  }

  private startMemoryMonitoring(): void {
    if (typeof window === 'undefined') return;

    // Monitor cache size
    setInterval(() => {
      this.optimizeCache();
    }, 10000);

    // Clean up object pools
    setInterval(() => {
      this.cleanupObjectPools();
    }, 30000);
  }

  private handleMemoryPressure(): void {
    console.warn('Memory pressure detected, initiating cleanup...');
    
    const result = this.optimize();
    
    // Notify registered callbacks
    this.memoryPressureCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Memory pressure callback error:', error);
      }
    });

    console.log('Memory optimization completed:', result);
  }

  optimize(): OptimizationResult {
    const result: OptimizationResult = {
      memoryFreed: 0,
      objectsPooled: 0,
      cacheCleared: 0,
      weakReferencesCreated: 0
    };

    // Clear expired cache entries
    result.cacheCleared = this.clearExpiredCache();
    
    // Optimize object pools
    result.objectsPooled = this.optimizeObjectPools();
    
    // Force garbage collection if available
    if (typeof window !== 'undefined' && (window as any).gc) {
      const beforeGC = this.getMemoryUsage();
      (window as any).gc();
      const afterGC = this.getMemoryUsage();
      result.memoryFreed = beforeGC - afterGC;
    }

    return result;
  }

  private optimizeForBackground(): void {
    // Aggressive cleanup when app is in background
    this.clearNonEssentialCache();
    this.pauseNonCriticalOperations();
    this.reduceObjectPoolSizes();
  }

  private optimizeForForeground(): void {
    // Restore normal operation when app comes to foreground
    this.resumeNonCriticalOperations();
    this.restoreObjectPoolSizes();
  }

  private clearNonEssentialCache(): void {
    const essentialKeys = new Set(['user-session', 'auth-token', 'critical-data']);
    
    for (const [key, value] of this.cacheStore.entries()) {
      if (!essentialKeys.has(key)) {
        this.cacheStore.delete(key);
      }
    }
  }

  private pauseNonCriticalOperations(): void {
    // Implement pausing of non-critical background operations
    // This would be integrated with other systems
  }

  private resumeNonCriticalOperations(): void {
    // Resume operations when returning to foreground
  }

  private reduceObjectPoolSizes(): void {
    for (const [poolName, pool] of this.objectPools.entries()) {
      const reducedSize = Math.floor(pool.length * 0.5);
      this.objectPools.set(poolName, pool.slice(0, reducedSize));
    }
  }

  private restoreObjectPoolSizes(): void {
    // Object pools will naturally grow back as needed
  }

  // Cache management
  setCache(key: string, data: any, ttl: number = 300000): void { // 5 minutes default
    const size = this.estimateObjectSize(data);
    
    // Check if adding this would exceed cache limit
    if (this.getCacheSize() + size > this.config.cacheMaxSize) {
      this.evictLRUCache();
    }

    this.cacheStore.set(key, {
      data,
      timestamp: Date.now(),
      size
    });
  }

  getCache(key: string): any | null {
    const entry = this.cacheStore.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > 300000) { // 5 minutes
      this.cacheStore.delete(key);
      return null;
    }

    return entry.data;
  }

  private clearExpiredCache(): number {
    let cleared = 0;
    const now = Date.now();
    
    for (const [key, entry] of this.cacheStore.entries()) {
      if (now - entry.timestamp > 300000) { // 5 minutes
        this.cacheStore.delete(key);
        cleared++;
      }
    }
    
    return cleared;
  }

  private evictLRUCache(): void {
    // Simple LRU eviction - remove oldest entries
    const entries = Array.from(this.cacheStore.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Remove oldest 25% of entries
    const toRemove = Math.floor(entries.length * 0.25);
    for (let i = 0; i < toRemove; i++) {
      this.cacheStore.delete(entries[i][0]);
    }
  }

  private getCacheSize(): number {
    let totalSize = 0;
    for (const entry of this.cacheStore.values()) {
      totalSize += entry.size;
    }
    return totalSize;
  }

  private optimizeCache(): void {
    const currentSize = this.getCacheSize();
    if (currentSize > this.config.cacheMaxSize) {
      this.evictLRUCache();
    }
  }

  // Object pooling
  createObjectPool(poolName: string, factory: () => any, initialSize: number = 10): void {
    if (!this.config.enableObjectPooling) return;

    const pool: any[] = [];
    for (let i = 0; i < initialSize; i++) {
      pool.push(factory());
    }
    this.objectPools.set(poolName, pool);
  }

  getFromPool(poolName: string, factory?: () => any): any {
    if (!this.config.enableObjectPooling) {
      return factory ? factory() : {};
    }

    const pool = this.objectPools.get(poolName);
    if (!pool || pool.length === 0) {
      return factory ? factory() : {};
    }

    return pool.pop();
  }

  returnToPool(poolName: string, object: any): void {
    if (!this.config.enableObjectPooling) return;

    const pool = this.objectPools.get(poolName);
    if (!pool) return;

    // Reset object state if it has a reset method
    if (typeof object.reset === 'function') {
      object.reset();
    }

    // Don't let pools grow too large
    if (pool.length < this.config.componentPoolSize) {
      pool.push(object);
    }
  }

  private optimizeObjectPools(): number {
    let optimized = 0;
    
    for (const [poolName, pool] of this.objectPools.entries()) {
      // Remove excess objects from pools
      const targetSize = Math.floor(this.config.componentPoolSize * 0.8);
      if (pool.length > targetSize) {
        const excess = pool.length - targetSize;
        pool.splice(targetSize);
        optimized += excess;
      }
    }
    
    return optimized;
  }

  private cleanupObjectPools(): void {
    for (const [poolName, pool] of this.objectPools.entries()) {
      // Clean up any objects that might have references to DOM elements
      for (let i = pool.length - 1; i >= 0; i--) {
        const obj = pool[i];
        if (this.hasStaleReferences(obj)) {
          pool.splice(i, 1);
        }
      }
    }
  }

  private hasStaleReferences(obj: any): boolean {
    // Simple check for stale DOM references
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        const value = obj[key];
        if (value && value.nodeType && !document.contains(value)) {
          return true;
        }
      }
    }
    return false;
  }

  // Weak references
  createWeakReference(target: object, data: any): void {
    if (!this.config.enableWeakReferences) return;
    this.weakReferences.set(target, data);
  }

  getWeakReference(target: object): any {
    return this.weakReferences.get(target);
  }

  // Component lifecycle management
  registerComponent(component: any): void {
    this.componentInstances.add(component);
  }

  unregisterComponent(component: any): void {
    // Component will be automatically removed from WeakSet when GC'd
    // But we can clean up any associated resources
    this.cleanupComponentResources(component);
  }

  private cleanupComponentResources(component: any): void {
    // Clean up any resources associated with the component
    if (component && typeof component.cleanup === 'function') {
      component.cleanup();
    }
  }

  // Memory pressure callbacks
  onMemoryPressure(callback: () => void): () => void {
    this.memoryPressureCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.memoryPressureCallbacks.delete(callback);
    };
  }

  // Utility methods
  private getMemoryUsage(): number {
    if (typeof window === 'undefined' || !(performance as any).memory) {
      return 0;
    }
    return (performance as any).memory.usedJSHeapSize;
  }

  private estimateObjectSize(obj: any): number {
    // Simple object size estimation
    const jsonString = JSON.stringify(obj);
    return new Blob([jsonString]).size;
  }

  // Bundle size optimization helpers
  enableLazyLoading(): void {
    // This would be used with dynamic imports
    // Implementation depends on the bundler configuration
  }

  preloadCriticalResources(resources: string[]): Promise<void[]> {
    const promises = resources.map(resource => {
      return new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.href = resource;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Failed to preload ${resource}`));
        document.head.appendChild(link);
      });
    });

    return Promise.all(promises);
  }

  getOptimizationStats(): {
    cacheSize: number;
    poolSizes: Record<string, number>;
    memoryUsage: number;
    componentCount: number;
  } {
    const poolSizes: Record<string, number> = {};
    for (const [name, pool] of this.objectPools.entries()) {
      poolSizes[name] = pool.length;
    }

    return {
      cacheSize: this.getCacheSize(),
      poolSizes,
      memoryUsage: this.getMemoryUsage(),
      componentCount: this.componentInstances.size || 0
    };
  }
}

export const memoryOptimizer = new MemoryOptimizer();
export { MemoryOptimizer };
export default MemoryOptimizer;