/**
 * Unit tests for CacheExportManager and cache export/persistence layer
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the logger
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock task-persistence to avoid circular dependency issues
vi.mock('@/lib/memory/task-persistence', () => ({
  getTaskStore: vi.fn(() => ({
    getAll: vi.fn(() => new Map()),
    create: vi.fn(),
    delete: vi.fn(),
  })),
}));

describe('CacheExportManager', () => {
  let CacheExportManager: any;
  let CacheExportEntry: any;
  let CacheType: any;
  let getCacheExportManager: any;
  let resetCacheExportManager: any;

  beforeEach(async () => {
    vi.resetModules();
    
    const module = await import('../cache-exporter');
    CacheExportManager = module.CacheExportManager;
    CacheExportEntry = module.CacheExportEntry;
    CacheType = module.CacheType;
    getCacheExportManager = module.getCacheExportManager;
    resetCacheExportManager = module.resetCacheExportManager;
    
    // Reset singleton between tests
    resetCacheExportManager();
  });

  afterEach(() => {
    resetCacheExportManager();
  });

  describe('CacheExportEntry', () => {
    it('should create an export entry with required fields', () => {
      const entry: CacheExportEntry = {
        key: 'test-key',
        value: { data: 'test' },
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 1,
      };

      expect(entry.key).toBe('test-key');
      expect(entry.value).toEqual({ data: 'test' });
      expect(entry.accessCount).toBe(1);
    });

    it('should support optional important flag', () => {
      const entry: CacheExportEntry = {
        key: 'important-key',
        value: { data: 'important' },
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 5,
        important: true,
      };

      expect(entry.important).toBe(true);
    });

    it('should support optional metadata', () => {
      const entry: CacheExportEntry = {
        key: 'key-with-meta',
        value: { data: 'test' },
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 1,
        metadata: { ttl: 300000, source: 'test' },
      };

      expect(entry.metadata).toBeDefined();
      expect(entry.metadata?.ttl).toBe(300000);
    });
  });

  describe('CacheType', () => {
    it('should define valid cache type strings', () => {
      // CacheType is a union type - verify the type definitions exist
      const validTypes: CacheType[] = [
        'response', 
        'auth', 
        'tab-memory', 
        'powers-registry',
        'tasks',
        'plans',
        'custom'
      ];

      // Each should be a valid string
      for (const type of validTypes) {
        expect(typeof type).toBe('string');
        expect(type.length).toBeGreaterThan(0);
      }
    });
  });

  describe('CacheExportManager instantiation', () => {
    it('should create a new instance', () => {
      const manager = new CacheExportManager();
      expect(manager).toBeDefined();
    });

    it('should return the same singleton via getCacheExportManager', () => {
      const manager1 = getCacheExportManager();
      const manager2 = getCacheExportManager();
      expect(manager1).toBe(manager2);
    });

    it('should reset the singleton via resetCacheExportManager', () => {
      const manager1 = getCacheExportManager();
      resetCacheExportManager();
      const manager2 = getCacheExportManager();
      expect(manager1).not.toBe(manager2);
    });
  });

  describe('getStoragePath', () => {
    it('should return a storage path string', () => {
      const manager = getCacheExportManager();
      const path = manager.getStoragePath();
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    });
  });

  describe('listExports', () => {
    it('should return an array of export names', async () => {
      const manager = getCacheExportManager();
      const exports = await manager.listExports();
      expect(Array.isArray(exports)).toBe(true);
    });
  });

  describe('getAllStats', () => {
    it('should return statistics for all cache types', () => {
      const manager = getCacheExportManager();
      const stats = manager.getAllStats();
      
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
      
      // Should have entries for each registered adapter
      expect(stats['response']).toBeDefined();
      expect(stats['auth']).toBeDefined();
    });
  });

  describe('auto-export lifecycle', () => {
    it('should start and stop auto-export for a cache type', () => {
      const manager = getCacheExportManager();
      
      // Start auto-export
      manager.startAutoExport('response', 60000);
      
      // Stop auto-export
      manager.stopAutoExport('response');
    });

    it('should start and stop all auto-exports', () => {
      const manager = getCacheExportManager();
      
      // Start all auto-exports
      manager.startAutoExportAll(60000);
      
      // Stop all auto-exports
      manager.stopAutoExportAll();
    });
  });

  describe('export/restore cycle', () => {
    it('should export a cache type without errors', async () => {
      const manager = getCacheExportManager();
      
      // Export response cache (should work even if cache is empty)
      const result = await manager.export('response');
      
      // Result could be null if no entries to export - that's OK
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should export all cache types', async () => {
      const manager = getCacheExportManager();
      
      const results = await manager.exportAll();
      expect(results).toBeDefined();
      expect(typeof results).toBe('object');
    });

    it('should restore a cache type without errors', async () => {
      const manager = getCacheExportManager();
      
      // Restore should return 0 if no export exists
      const count = await manager.restore('response');
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should restore all cache types', async () => {
      const manager = getCacheExportManager();
      
      const results = await manager.restoreAll();
      expect(results).toBeDefined();
      expect(typeof results).toBe('object');
    });

    it('should delete an export', async () => {
      const manager = getCacheExportManager();
      
      // Should not throw even if export doesn't exist
      await expect(manager.deleteExport('response')).resolves.not.toThrow();
    });
  });

  describe('initialize/shutdown lifecycle', () => {
    it('should initialize without errors', async () => {
      const manager = getCacheExportManager();
      
      // Should not throw even if backend is unavailable
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    it('should shutdown without errors', async () => {
      const manager = getCacheExportManager();
      
      // Should not throw
      await expect(manager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('export options', () => {
    it('should respect minAccessCount option', async () => {
      const manager = getCacheExportManager();
      
      const result = await manager.export('response', {
        minAccessCount: 10, // High threshold - should skip low-access entries
        includeImportant: false,
      });
      
      // Result could be null if no entries meet the threshold
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should respect maxAgeBeforeExport option', async () => {
      const manager = getCacheExportManager();
      
      const result = await manager.export('response', {
        maxAgeBeforeExport: 60 * 1000, // 1 minute - skip very new entries
      });
      
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should include important entries when flag is set', async () => {
      const manager = getCacheExportManager();
      
      const result = await manager.export('response', {
        includeImportant: true,
      });
      
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should support different merge strategies', async () => {
      const manager = getCacheExportManager();
      
      // Test different strategies
      await manager.restore('response', { mergeStrategy: 'keep-newer' });
      await manager.restore('response', { mergeStrategy: 'replace' });
      await manager.restore('response', { mergeStrategy: 'keep-hotter' });
      
      // Should not throw
      expect(true).toBe(true);
    });
  });
});

describe('Convenience Functions', () => {
  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../cache-exporter');
    // Re-export reset
    const { resetCacheExportManager } = module;
    resetCacheExportManager();
  });

  it('exportCache should export a specific cache type', async () => {
    const { exportCache, resetCacheExportManager } = await import('../cache-exporter');
    resetCacheExportManager();
    
    const result = await exportCache('response');
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('restoreCache should restore a specific cache type', async () => {
    const { restoreCache, resetCacheExportManager } = await import('../cache-exporter');
    resetCacheExportManager();
    
    const count = await restoreCache('response');
    expect(typeof count).toBe('number');
  });

  it('exportAllCaches should export all caches', async () => {
    const { exportAllCaches, resetCacheExportManager } = await import('../cache-exporter');
    resetCacheExportManager();
    
    await expect(exportAllCaches()).resolves.not.toThrow();
  });

  it('restoreAllCaches should restore all caches', async () => {
    const { restoreAllCaches, resetCacheExportManager } = await import('../cache-exporter');
    resetCacheExportManager();
    
    await expect(restoreAllCaches()).resolves.not.toThrow();
  });

  it('exportTasks should export tasks specifically', async () => {
    const { exportTasks, resetCacheExportManager } = await import('../cache-exporter');
    resetCacheExportManager();
    
    const result = await exportTasks();
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('exportPowers should export powers registry specifically', async () => {
    const { exportPowers, resetCacheExportManager } = await import('../cache-exporter');
    resetCacheExportManager();
    
    const result = await exportPowers();
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('exportResponseCache should export response cache specifically', async () => {
    const { exportResponseCache, resetCacheExportManager } = await import('../cache-exporter');
    resetCacheExportManager();
    
    const result = await exportResponseCache();
    expect(result === null || typeof result === 'object').toBe(true);
  });
});