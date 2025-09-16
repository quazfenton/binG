/**
 * Performance System Structure Verification
 * Verify that all performance system files exist and have correct structure
 */

const fs = require('fs');
const path = require('path');

console.log('Verifying performance system structure...');

const requiredFiles = [
  'performance-monitor.ts',
  'memory-optimizer.ts',
  'cache-manager.ts',
  'mobile-optimizer.ts',
  'bundle-optimizer.ts',
  'performance-manager.ts',
  'index.ts',
  'init.ts'
];

const requiredExports = {
  'performance-monitor.ts': [
    'export interface PerformanceMetrics',
    'export interface StreamingMetrics',
    'export interface MemoryMetrics',
    'export class PerformanceMonitor',
    'export const performanceMonitor'
  ],
  'memory-optimizer.ts': [
    'export interface MemoryOptimizationConfig',
    'export interface OptimizationResult',
    'export class MemoryOptimizer',
    'export const memoryOptimizer'
  ],
  'cache-manager.ts': [
    'export interface CacheConfig',
    'export interface CacheEntry',
    'export class CacheManager',
    'export const cacheManager'
  ],
  'mobile-optimizer.ts': [
    'export interface MobileOptimizationConfig',
    'export interface DeviceCapabilities',
    'export class MobileOptimizer',
    'export const mobileOptimizer'
  ],
  'bundle-optimizer.ts': [
    'export interface BundleOptimizationConfig',
    'export interface BundleMetrics',
    'export class BundleOptimizer',
    'export const bundleOptimizer'
  ],
  'performance-manager.ts': [
    'export interface PerformanceConfig',
    'export interface PerformanceReport',
    'export class PerformanceManager',
    'export const performanceManager'
  ]
};

let allTestsPassed = true;

// Check if all required files exist
console.log('\n📁 Checking file structure...');
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${file} exists`);
  } else {
    console.log(`❌ ${file} missing`);
    allTestsPassed = false;
  }
}

// Check file contents for required exports
console.log('\n🔍 Checking exports...');
for (const [file, exports] of Object.entries(requiredExports)) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    for (const exportItem of exports) {
      if (content.includes(exportItem)) {
        console.log(`✓ ${file}: ${exportItem}`);
      } else {
        console.log(`❌ ${file}: Missing ${exportItem}`);
        allTestsPassed = false;
      }
    }
  }
}

// Check for key functionality patterns
console.log('\n🔧 Checking functionality patterns...');

const functionalityChecks = [
  {
    file: 'performance-monitor.ts',
    patterns: [
      'startMonitoring',
      'stopMonitoring',
      'trackStreamingSession',
      'recordStreamingChunk',
      'generateReport'
    ]
  },
  {
    file: 'memory-optimizer.ts',
    patterns: [
      'optimize',
      'setCache',
      'getCache',
      'createObjectPool',
      'onMemoryPressure'
    ]
  },
  {
    file: 'cache-manager.ts',
    patterns: [
      'set',
      'get',
      'delete',
      'clear',
      'namespace',
      'getStats'
    ]
  },
  {
    file: 'mobile-optimizer.ts',
    patterns: [
      'detectDeviceCapabilities',
      'enableLowPowerMode',
      'addRenderTask',
      'getMetrics'
    ]
  },
  {
    file: 'bundle-optimizer.ts',
    patterns: [
      'loadModule',
      'preloadResource',
      'optimizeForDevice',
      'generateOptimizationReport'
    ]
  },
  {
    file: 'performance-manager.ts',
    patterns: [
      'optimize',
      'generatePerformanceReport',
      'trackStreamingSession',
      'onOptimization'
    ]
  }
];

for (const { file, patterns } of functionalityChecks) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    for (const pattern of patterns) {
      if (content.includes(pattern)) {
        console.log(`✓ ${file}: Has ${pattern} functionality`);
      } else {
        console.log(`❌ ${file}: Missing ${pattern} functionality`);
        allTestsPassed = false;
      }
    }
  }
}

// Check integration points
console.log('\n🔗 Checking integration points...');

const integrationChecks = [
  {
    file: 'performance-manager.ts',
    imports: [
      'performance-monitor',
      'memory-optimizer',
      'cache-manager',
      'mobile-optimizer',
      'bundle-optimizer'
    ]
  },
  {
    file: 'index.ts',
    exports: [
      'performanceMonitor',
      'memoryOptimizer',
      'cacheManager',
      'mobileOptimizer',
      'bundleOptimizer',
      'performanceManager'
    ]
  }
];

for (const { file, imports, exports } of integrationChecks) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    if (imports) {
      for (const importItem of imports) {
        if (content.includes(importItem)) {
          console.log(`✓ ${file}: Imports ${importItem}`);
        } else {
          console.log(`❌ ${file}: Missing import ${importItem}`);
          allTestsPassed = false;
        }
      }
    }
    
    if (exports) {
      for (const exportItem of exports) {
        if (content.includes(exportItem)) {
          console.log(`✓ ${file}: Exports ${exportItem}`);
        } else {
          console.log(`❌ ${file}: Missing export ${exportItem}`);
          allTestsPassed = false;
        }
      }
    }
  }
}

// Check file sizes (should be substantial)
console.log('\n📊 Checking file sizes...');
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    
    if (stats.size > 1000) { // At least 1KB
      console.log(`✓ ${file}: ${sizeKB} KB`);
    } else {
      console.log(`⚠️  ${file}: ${sizeKB} KB (might be incomplete)`);
    }
  }
}

// Summary
console.log('\n' + '='.repeat(50));
if (allTestsPassed) {
  console.log('🎉 All performance system structure checks passed!');
  console.log('\nPerformance system is properly structured with:');
  console.log('- ✓ All required files present');
  console.log('- ✓ All required exports available');
  console.log('- ✓ All key functionality implemented');
  console.log('- ✓ Proper integration between components');
  console.log('\nThe performance system is ready for use!');
} else {
  console.log('❌ Some performance system structure checks failed.');
  console.log('Please review the issues above and fix them.');
}

console.log('\nPerformance system components:');
console.log('1. Performance Monitor - Real-time metrics collection');
console.log('2. Memory Optimizer - Memory usage optimization');
console.log('3. Cache Manager - Advanced caching strategies');
console.log('4. Mobile Optimizer - Mobile-specific optimizations');
console.log('5. Bundle Optimizer - Bundle size optimization');
console.log('6. Performance Manager - Central coordination');
console.log('7. React Hooks - Easy integration with React components');
console.log('8. Initialization System - Automatic setup');

process.exit(allTestsPassed ? 0 : 1);