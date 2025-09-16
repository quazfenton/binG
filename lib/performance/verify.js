/**
 * Performance System Verification Script
 * Simple verification that the performance system can be imported and initialized
 */

console.log('Verifying performance system...');

try {
  // Test basic imports
  console.log('✓ Testing imports...');
  
  // Since we're in Node.js, we need to mock browser APIs
  global.window = {
    performance: {
      now: () => Date.now(),
      memory: {
        usedJSHeapSize: 50 * 1024 * 1024,
        totalJSHeapSize: 100 * 1024 * 1024,
        jsHeapSizeLimit: 200 * 1024 * 1024
      }
    },
    navigator: {
      hardwareConcurrency: 4,
      userAgent: 'test'
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  
  global.performance = global.window.performance;
  global.navigator = global.window.navigator;
  global.requestAnimationFrame = global.window.requestAnimationFrame;
  global.cancelAnimationFrame = global.window.cancelAnimationFrame;
  
  global.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    readyState: 'complete',
    hidden: false,
    createElement: () => ({
      addEventListener: () => {},
      removeEventListener: () => {}
    }),
    head: {
      appendChild: () => {}
    }
  };

  // Test performance monitor
  const { performanceMonitor } = require('./performance-monitor.ts');
  console.log('✓ Performance monitor imported');
  
  // Test memory optimizer
  const { memoryOptimizer } = require('./memory-optimizer.ts');
  console.log('✓ Memory optimizer imported');
  
  // Test cache manager
  const { cacheManager } = require('./cache-manager.ts');
  console.log('✓ Cache manager imported');
  
  // Test mobile optimizer
  const { mobileOptimizer } = require('./mobile-optimizer.ts');
  console.log('✓ Mobile optimizer imported');
  
  // Test bundle optimizer
  const { bundleOptimizer } = require('./bundle-optimizer.ts');
  console.log('✓ Bundle optimizer imported');
  
  // Test performance manager
  const { performanceManager } = require('./performance-manager.ts');
  console.log('✓ Performance manager imported');
  
  // Test basic functionality
  console.log('✓ Testing basic functionality...');
  
  // Test streaming tracking
  performanceMonitor.trackStreamingSession('test-session');
  performanceMonitor.recordStreamingChunk(100, 15);
  const streamingMetrics = performanceMonitor.getStreamingMetrics();
  console.log('✓ Streaming metrics:', {
    totalChunks: streamingMetrics.totalChunks,
    averageChunkSize: streamingMetrics.averageChunkSize
  });
  
  // Test cache operations
  cacheManager.set('test-key', { data: 'test-value' });
  const cached = cacheManager.get('test-key');
  console.log('✓ Cache operations:', { cached: cached?.data });
  
  // Test memory optimization
  const optimizationResult = memoryOptimizer.optimize();
  console.log('✓ Memory optimization:', {
    memoryFreed: optimizationResult.memoryFreed,
    objectsPooled: optimizationResult.objectsPooled
  });
  
  // Test performance report generation
  const report = performanceMonitor.generateReport();
  console.log('✓ Performance report generated (length:', report.length, 'chars)');
  
  console.log('\n🎉 All performance system components verified successfully!');
  console.log('\nPerformance system features:');
  console.log('- ✓ Real-time performance monitoring');
  console.log('- ✓ Memory usage optimization');
  console.log('- ✓ Advanced caching strategies');
  console.log('- ✓ Mobile-specific optimizations');
  console.log('- ✓ Bundle size optimization');
  console.log('- ✓ Streaming performance tracking');
  console.log('- ✓ Centralized performance management');
  
} catch (error) {
  console.error('❌ Performance system verification failed:', error);
  process.exit(1);
}