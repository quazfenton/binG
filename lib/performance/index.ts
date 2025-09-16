/**
 * Performance Optimization and Monitoring System
 * 
 * This module provides comprehensive performance optimization and monitoring
 * capabilities for the application, including:
 * 
 * - Real-time performance monitoring
 * - Memory usage optimization
 * - Advanced caching strategies
 * - Mobile-specific optimizations
 * - Bundle size optimization
 * - Centralized performance management
 */

// Core performance monitoring
export {
  performanceMonitor,
  PerformanceMonitor,
  type PerformanceMetrics,
  type StreamingMetrics,
  type MemoryMetrics,
  type NetworkMetrics,
  type UIMetrics,
  type MobileMetrics,
  type MemoryLeak
} from './performance-monitor';

// Memory optimization
export {
  memoryOptimizer,
  MemoryOptimizer,
  type MemoryOptimizationConfig,
  type OptimizationResult
} from './memory-optimizer';

// Cache management
export {
  cacheManager,
  CacheManager,
  type CacheConfig,
  type CacheEntry,
  type CacheStats,
  type CacheStrategy
} from './cache-manager';

// Mobile optimization
export {
  mobileOptimizer,
  MobileOptimizer,
  type MobileOptimizationConfig,
  type DeviceCapabilities,
  type MobileMetrics as MobileOptimizerMetrics
} from './mobile-optimizer';

// Bundle optimization
export {
  bundleOptimizer,
  BundleOptimizer,
  type BundleOptimizationConfig,
  type BundleMetrics,
  type LoadingStrategy
} from './bundle-optimizer';

// Central performance manager
export {
  performanceManager,
  PerformanceManager,
  type PerformanceConfig,
  type OptimizationThresholds,
  type PerformanceReport
} from './performance-manager';

// Convenience exports for common use cases
export const performance = {
  // Quick access to main systems
  monitor: performanceMonitor,
  memory: memoryOptimizer,
  cache: cacheManager,
  mobile: mobileOptimizer,
  bundle: bundleOptimizer,
  manager: performanceManager,

  // Common operations
  async optimize() {
    return performanceManager.optimize();
  },

  async generateReport() {
    return performanceManager.generateFullReport();
  },

  startMonitoring() {
    performanceManager.updateConfig({ enableMonitoring: true });
  },

  stopMonitoring() {
    performanceManager.updateConfig({ enableMonitoring: false });
  },

  // Streaming helpers
  trackStreaming(sessionId: string) {
    performanceManager.trackStreamingSession(sessionId);
  },

  recordChunk(size: number, renderTime: number) {
    performanceManager.recordStreamingChunk(size, renderTime);
  },

  recordError() {
    performanceManager.recordStreamingError();
  },

  // Cache helpers
  setCache<T>(key: string, data: T, ttl?: number) {
    performanceManager.setCache(key, data, ttl);
  },

  getCache<T>(key: string): T | null {
    return performanceManager.getCache<T>(key);
  },

  // Mobile helpers
  addRenderTask(task: () => void) {
    performanceManager.addRenderTask(task);
  },

  // Bundle helpers
  async loadModule(specifier: string) {
    return performanceManager.loadModule(specifier);
  },

  async preloadResource(url: string) {
    return performanceManager.preloadResource(url);
  }
};

// Default export
export default performance;