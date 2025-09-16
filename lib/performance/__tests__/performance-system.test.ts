/**
 * Performance System Tests
 * Test suite for performance monitoring and optimization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { performanceMonitor } from '../performance-monitor';
import { memoryOptimizer } from '../memory-optimizer';
import { cacheManager } from '../cache-manager';
import { performanceManager } from '../performance-manager';

// Mock performance API
const mockPerformance = {
  now: vi.fn(() => Date.now()),
  memory: {
    usedJSHeapSize: 50 * 1024 * 1024, // 50MB
    totalJSHeapSize: 100 * 1024 * 1024, // 100MB
    jsHeapSizeLimit: 200 * 1024 * 1024 // 200MB
  },
  mark: vi.fn(),
  measure: vi.fn()
};

// Mock navigator
const mockNavigator = {
  hardwareConcurrency: 4,
  deviceMemory: 8,
  connection: {
    effectiveType: '4g'
  }
};

// Mock window
const mockWindow = {
  performance: mockPerformance,
  navigator: mockNavigator,
  requestAnimationFrame: vi.fn((cb) => setTimeout(cb, 16)),
  cancelAnimationFrame: vi.fn()
};

// Setup global mocks
beforeEach(() => {
  global.performance = mockPerformance as any;
  global.navigator = mockNavigator as any;
  global.window = mockWindow as any;
  global.requestAnimationFrame = mockWindow.requestAnimationFrame;
  global.cancelAnimationFrame = mockWindow.cancelAnimationFrame;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Performance Monitor', () => {
  it('should initialize with default metrics', () => {
    const metrics = performanceMonitor.getMetrics();
    
    expect(metrics).toBeDefined();
    expect(metrics.streaming).toBeDefined();
    expect(metrics.memory).toBeDefined();
    expect(metrics.network).toBeDefined();
    expect(metrics.ui).toBeDefined();
    expect(metrics.mobile).toBeDefined();
  });

  it('should track streaming sessions', () => {
    const sessionId = 'test-session-123';
    performanceMonitor.trackStreamingSession(sessionId);
    
    const metrics = performanceMonitor.getStreamingMetrics();
    expect(metrics.sessionId).toBe(sessionId);
    expect(metrics.totalChunks).toBe(0);
  });

  it('should record streaming chunks', () => {
    const sessionId = 'test-session-123';
    performanceMonitor.trackStreamingSession(sessionId);
    
    performanceMonitor.recordStreamingChunk(100, 15.5);
    
    const metrics = performanceMonitor.getStreamingMetrics();
    expect(metrics.totalChunks).toBe(1);
    expect(metrics.averageChunkSize).toBe(100);
    expect(metrics.renderLatency).toBe(15.5);
  });

  it('should record streaming errors', () => {
    const sessionId = 'test-session-123';
    performanceMonitor.trackStreamingSession(sessionId);
    
    performanceMonitor.recordStreamingError();
    
    const metrics = performanceMonitor.getStreamingMetrics();
    expect(metrics.errorRate).toBeGreaterThan(0);
  });

  it('should generate performance report', () => {
    const report = performanceMonitor.generateReport();
    
    expect(report).toContain('Performance Report');
    expect(report).toContain('Streaming Performance');
    expect(report).toContain('Memory Usage');
    expect(report).toContain('Network Performance');
  });
});

describe('Memory Optimizer', () => {
  it('should optimize memory usage', () => {
    const result = memoryOptimizer.optimize();
    
    expect(result).toBeDefined();
    expect(typeof result.memoryFreed).toBe('number');
    expect(typeof result.objectsPooled).toBe('number');
    expect(typeof result.cacheCleared).toBe('number');
  });

  it('should manage cache entries', () => {
    memoryOptimizer.setCache('test-key', { data: 'test-value' });
    
    const cached = memoryOptimizer.getCache('test-key');
    expect(cached).toEqual({ data: 'test-value' });
  });

  it('should create and manage object pools', () => {
    const factory = () => ({ reset: vi.fn() });
    memoryOptimizer.createObjectPool('test-pool', factory, 5);
    
    const obj1 = memoryOptimizer.getFromPool('test-pool', factory);
    expect(obj1).toBeDefined();
    
    memoryOptimizer.returnToPool('test-pool', obj1);
    
    const obj2 = memoryOptimizer.getFromPool('test-pool', factory);
    expect(obj2).toBe(obj1); // Should reuse the returned object
  });

  it('should provide optimization stats', () => {
    const stats = memoryOptimizer.getOptimizationStats();
    
    expect(stats).toBeDefined();
    expect(typeof stats.cacheSize).toBe('number');
    expect(typeof stats.memoryUsage).toBe('number');
    expect(stats.poolSizes).toBeDefined();
  });
});

describe('Cache Manager', () => {
  beforeEach(() => {
    cacheManager.clear();
  });

  it('should set and get cache entries', () => {
    const testData = { message: 'Hello, World!' };
    cacheManager.set('test-key', testData);
    
    const retrieved = cacheManager.get('test-key');
    expect(retrieved).toEqual(testData);
  });

  it('should handle cache expiration', async () => {
    const testData = { message: 'Expires soon' };
    cacheManager.set('expire-key', testData, 100); // 100ms TTL
    
    // Should be available immediately
    expect(cacheManager.get('expire-key')).toEqual(testData);
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should be expired
    expect(cacheManager.get('expire-key')).toBeNull();
  });

  it('should support cache namespaces', () => {
    const namespace = cacheManager.namespace('test-ns');
    
    namespace.set('key1', 'value1');
    namespace.set('key2', 'value2');
    
    expect(namespace.get('key1')).toBe('value1');
    expect(namespace.get('key2')).toBe('value2');
    
    // Should not interfere with global cache
    expect(cacheManager.get('key1')).toBeNull();
  });

  it('should provide cache statistics', () => {
    cacheManager.set('stat-key1', 'value1');
    cacheManager.set('stat-key2', 'value2');
    cacheManager.get('stat-key1'); // Hit
    cacheManager.get('nonexistent'); // Miss
    
    const stats = cacheManager.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.totalSize).toBeGreaterThan(0);
  });

  it('should support batch operations', async () => {
    const entries = new Map([
      ['batch1', 'value1'],
      ['batch2', 'value2'],
      ['batch3', 'value3']
    ]);
    
    await cacheManager.batchSet(Array.from(entries.entries()).map(([key, data]) => ({ key, data })));
    
    const results = await cacheManager.batchGet(['batch1', 'batch2', 'batch3']);
    expect(results.get('batch1')).toBe('value1');
    expect(results.get('batch2')).toBe('value2');
    expect(results.get('batch3')).toBe('value3');
  });
});

describe('Performance Manager', () => {
  it('should initialize with default configuration', () => {
    const config = performanceManager.getConfig();
    
    expect(config.enableMonitoring).toBe(true);
    expect(config.enableMemoryOptimization).toBe(true);
    expect(config.enableCaching).toBe(true);
    expect(config.enableMobileOptimization).toBe(true);
    expect(config.enableBundleOptimization).toBe(true);
  });

  it('should generate performance reports', async () => {
    const report = await performanceManager.generatePerformanceReport();
    
    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.overall).toBeDefined();
    expect(report.memory).toBeDefined();
    expect(report.cache).toBeDefined();
    expect(report.mobile).toBeDefined();
    expect(report.bundle).toBeDefined();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it('should perform optimization', async () => {
    const report = await performanceManager.optimize();
    
    expect(report).toBeDefined();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.recommendations).toBeDefined();
  });

  it('should track streaming operations', () => {
    const sessionId = 'perf-test-session';
    
    performanceManager.trackStreamingSession(sessionId);
    performanceManager.recordStreamingChunk(256, 12.5);
    performanceManager.recordStreamingError();
    
    // Should not throw errors
    expect(true).toBe(true);
  });

  it('should manage cache operations', () => {
    performanceManager.setCache('perf-key', { test: 'data' }, 5000);
    
    const cached = performanceManager.getCache('perf-key');
    expect(cached).toEqual({ test: 'data' });
  });

  it('should provide optimization status', () => {
    const status = performanceManager.getOptimizationStatus();
    
    expect(status).toBeDefined();
    expect(typeof status.lastOptimization).toBe('number');
    expect(typeof status.nextOptimization).toBe('number');
    expect(typeof status.isLowPowerMode).toBe('boolean');
    expect(typeof status.memoryPressure).toBe('boolean');
  });

  it('should generate full report', async () => {
    const fullReport = await performanceManager.generateFullReport();
    
    expect(fullReport).toBeDefined();
    expect(typeof fullReport).toBe('string');
    expect(fullReport).toContain('Performance Manager Report');
    expect(fullReport).toContain('Overall Score');
  });

  it('should handle configuration updates', () => {
    const newConfig = {
      enableMonitoring: false,
      autoOptimization: false
    };
    
    performanceManager.updateConfig(newConfig);
    
    const config = performanceManager.getConfig();
    expect(config.enableMonitoring).toBe(false);
    expect(config.autoOptimization).toBe(false);
  });
});

describe('Integration Tests', () => {
  it('should integrate streaming with performance monitoring', () => {
    const sessionId = 'integration-test';
    
    // Start tracking
    performanceManager.trackStreamingSession(sessionId);
    
    // Simulate streaming chunks
    for (let i = 0; i < 10; i++) {
      performanceManager.recordStreamingChunk(100 + i * 10, 10 + i);
    }
    
    // Simulate an error
    performanceManager.recordStreamingError();
    
    const metrics = performanceMonitor.getStreamingMetrics();
    expect(metrics.totalChunks).toBe(10);
    expect(metrics.errorRate).toBeGreaterThan(0);
  });

  it('should integrate cache with memory optimization', () => {
    // Fill cache with test data
    for (let i = 0; i < 100; i++) {
      performanceManager.setCache(`test-key-${i}`, { data: `value-${i}` });
    }
    
    // Perform optimization
    const result = memoryOptimizer.optimize();
    
    expect(result.cacheCleared).toBeGreaterThanOrEqual(0);
  });

  it('should handle performance degradation scenarios', async () => {
    // Simulate high memory usage
    mockPerformance.memory.usedJSHeapSize = 180 * 1024 * 1024; // 180MB
    
    const report = await performanceManager.generatePerformanceReport();
    
    // Should detect performance issues
    expect(report.score).toBeLessThan(100);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});

export {};